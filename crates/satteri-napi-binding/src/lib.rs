#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

// MDX compilation options (JS-facing)

/// Static optimization config passed from JavaScript.
#[napi(object)]
pub struct JsOptimizeStaticConfig {
    /// Component/element name to wrap collapsed HTML in (e.g. "Fragment", "div").
    pub component: String,
    /// Prop name for the HTML string (e.g. "set:html", "dangerouslySetInnerHTML").
    pub prop: String,
    /// If true, prop value is wrapped as `{ __html: "..." }` (React-style).
    pub wrap_prop_value: Option<bool>,
    /// Element tag names to exclude from collapsing.
    pub ignore_elements: Option<Vec<String>>,
}

/// MDX compile options passed from JavaScript.
#[napi(object)]
pub struct JsMdxOptions {
    /// Static subtree optimization. If provided, static subtrees are collapsed
    /// into raw HTML strings using the specified component and prop.
    pub optimize_static: Option<JsOptimizeStaticConfig>,
}

fn js_options_to_rust(opts: Option<JsMdxOptions>) -> satteri_mdxjs::Options {
    let mut options = satteri_mdxjs::Options::default();
    if let Some(js) = opts {
        if let Some(config) = js.optimize_static {
            options.optimize_static = Some(satteri_mdxjs::OptimizeStaticConfig {
                component: config.component,
                prop: config.prop,
                wrap_prop_value: config.wrap_prop_value.unwrap_or(false),
                ignore_elements: config.ignore_elements.unwrap_or_default(),
            });
        }
    }
    options
}

// MDX compilation

/// Compile MDX source directly to JavaScript.
#[napi]
pub fn compile_mdx(source: String, options: Option<JsMdxOptions>) -> Result<String> {
    let opts = js_options_to_rust(options);
    satteri_mdxjs::compile(&source, &opts).map_err(|e| napi::Error::from_reason(e.to_string()))
}

// Direct rendering (no handle needed)

/// Parse Markdown source and return HTML string directly.
/// Uses pulldown-cmark's streaming renderer, skipping the arena entirely.
#[napi]
pub fn parse_to_html(source: String) -> Result<String> {
    let parser =
        satteri_pulldown_cmark::Parser::new_ext(&source, satteri_pulldown_cmark::DEFAULT_OPTIONS);
    let mut html = String::with_capacity(source.len());
    satteri_pulldown_cmark::html::push_html(&mut html, parser);
    Ok(html)
}

// Handle-based API: arena stays in Rust, no buffer copies to JS

use std::sync::Mutex;

type ArenaHandle = External<Mutex<satteri_arena::Arena>>;

fn make_parse_fn(mdx: bool) -> impl Fn(&str) -> satteri_arena::Arena {
    move |source: &str| -> satteri_arena::Arena {
        let opts = if mdx {
            satteri_pulldown_cmark::MDX_OPTIONS
        } else {
            satteri_pulldown_cmark::DEFAULT_OPTIONS
        };
        let (mut parsed, _errors) = satteri_pulldown_cmark::parse(source, opts);
        parsed.mdx = mdx;
        parsed
    }
}

/// A subscription passed from JS.
#[napi(object)]
pub struct JsSubscription {
    pub node_type: u8,
    pub tag_filter: Vec<String>,
}

/// Parse markdown source into an MDAST arena handle.
#[napi]
pub fn create_mdast_handle(source: String) -> Result<ArenaHandle> {
    let (mut arena, _) =
        satteri_pulldown_cmark::parse(&source, satteri_pulldown_cmark::DEFAULT_OPTIONS);
    arena.mdx = false;
    Ok(External::new(Mutex::new(arena)))
}

/// Parse MDX source into an MDAST arena handle.
#[napi]
pub fn create_mdx_mdast_handle(source: String) -> Result<ArenaHandle> {
    let (mut arena, _) =
        satteri_pulldown_cmark::parse(&source, satteri_pulldown_cmark::MDX_OPTIONS);
    arena.mdx = true;
    Ok(External::new(Mutex::new(arena)))
}

/// Serialize an MDAST handle to a binary buffer (read-only snapshot for JS visitor).
#[napi]
pub fn serialize_mdast_handle(handle: &ArenaHandle) -> Result<Uint8Array> {
    let arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    Ok(Uint8Array::new(arena.to_raw_buffer()))
}

/// Get the source string from an MDAST handle.
#[napi]
pub fn get_handle_source(handle: &ArenaHandle) -> Result<String> {
    let arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    Ok(arena.source().to_string())
}

/// Set the `data` blob (JSON bytes) for a node in the handle's arena.
#[napi]
pub fn set_node_data(handle: &ArenaHandle, node_id: u32, json: Uint8Array) -> Result<()> {
    let mut arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    arena.set_node_data(node_id, json.to_vec());
    Ok(())
}

/// Walk an MDAST handle's arena and return matched nodes as a flat binary buffer.
#[napi]
pub fn walk_mdast_handle(
    handle: &ArenaHandle,
    subscriptions: Vec<JsSubscription>,
) -> Result<Uint8Array> {
    let arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    let subs: Vec<satteri_ast::walk::Subscription> = subscriptions
        .into_iter()
        .map(|s| satteri_ast::walk::Subscription {
            node_type: s.node_type,
            tag_filter: s.tag_filter,
        })
        .collect();
    Ok(Uint8Array::new(
        satteri_ast::walk::walk_and_collect_with_mode(
            &arena,
            &subs,
            satteri_ast::walk::WalkMode::Mdast,
        ),
    ))
}

/// Apply a command buffer to an MDAST handle in-place.
#[napi]
pub fn apply_commands_to_mdast_handle(handle: &ArenaHandle, command_buf: Uint8Array) -> Result<()> {
    let mut arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    let parse_markdown = make_parse_fn(arena.mdx);
    let owned = std::mem::replace(&mut *arena, satteri_arena::Arena::new(String::new()));
    let new_arena = satteri_plugin_api::apply_commands(owned, &command_buf, &parse_markdown)
        .map_err(|e| napi::Error::from_reason(format!("command error: {e}")))?;
    *arena = new_arena;
    Ok(())
}

/// Convert an MDAST handle to a HAST handle. The MDAST handle is consumed (emptied).
#[napi]
pub fn convert_mdast_to_hast_handle(handle: &ArenaHandle) -> Result<ArenaHandle> {
    let mut arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    let mdx = arena.mdx;
    let owned = std::mem::replace(&mut *arena, satteri_arena::Arena::new(String::new()));
    let mut hast = satteri_ast::hast::mdast_arena_to_hast_arena(&owned);
    hast.mdx = mdx;
    Ok(External::new(Mutex::new(hast)))
}

/// Apply MDAST commands and convert to HAST handle in one step.
/// The MDAST handle is consumed (emptied).
#[napi]
pub fn apply_commands_and_convert_to_hast_handle(
    handle: &ArenaHandle,
    command_buf: Uint8Array,
) -> Result<ArenaHandle> {
    let mut arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    let mdx = arena.mdx;
    let parse_markdown = make_parse_fn(mdx);
    let owned = std::mem::replace(&mut *arena, satteri_arena::Arena::new(String::new()));
    let mutated = satteri_plugin_api::apply_commands(owned, &command_buf, &parse_markdown)
        .map_err(|e| napi::Error::from_reason(format!("command error: {e}")))?;
    let mut hast_arena = satteri_ast::hast::mdast_arena_to_hast_arena(&mutated);
    hast_arena.mdx = mdx;
    Ok(External::new(Mutex::new(hast_arena)))
}

/// Parse markdown source and convert to HAST. Returns an opaque handle.
/// The arena stays in Rust memory, no buffer is copied to JS.
#[napi]
pub fn create_hast_handle(source: String) -> Result<ArenaHandle> {
    let (mdast, _) =
        satteri_pulldown_cmark::parse(&source, satteri_pulldown_cmark::DEFAULT_OPTIONS);
    let mut hast = satteri_ast::hast::mdast_arena_to_hast_arena(&mdast);
    hast.mdx = false;
    Ok(External::new(Mutex::new(hast)))
}

/// Parse MDX source and convert to HAST. Returns an opaque handle.
#[napi]
pub fn create_mdx_hast_handle(source: String) -> Result<ArenaHandle> {
    let (mdast, _) = satteri_pulldown_cmark::parse(&source, satteri_pulldown_cmark::MDX_OPTIONS);
    let mut hast = satteri_ast::hast::mdast_arena_to_hast_arena(&mdast);
    hast.mdx = true;
    Ok(External::new(Mutex::new(hast)))
}

/// Walk a handle's arena and return matched nodes as a flat binary buffer.
#[napi]
pub fn walk_handle(handle: &ArenaHandle, subscriptions: Vec<JsSubscription>) -> Result<Uint8Array> {
    let arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    let subs: Vec<satteri_ast::walk::Subscription> = subscriptions
        .into_iter()
        .map(|s| satteri_ast::walk::Subscription {
            node_type: s.node_type,
            tag_filter: s.tag_filter,
        })
        .collect();
    Ok(Uint8Array::new(satteri_ast::walk::walk_and_collect(
        &arena, &subs,
    )))
}

/// Apply a command buffer to a handle's arena in-place. No serialize/deserialize.
#[napi]
pub fn apply_commands_to_handle(handle: &ArenaHandle, command_buf: Uint8Array) -> Result<()> {
    let mut arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;

    let parse_markdown = make_parse_fn(arena.mdx);

    // apply_commands takes ownership, so swap out the arena
    let owned = std::mem::replace(&mut *arena, satteri_arena::Arena::new(String::new()));
    let new_arena = satteri_plugin_api::apply_commands(owned, &command_buf, &parse_markdown)
        .map_err(|e| napi::Error::from_reason(format!("command error: {e}")))?;
    *arena = new_arena;
    Ok(())
}

/// Serialize a handle's arena to a binary buffer (for fallback paths like transformRoot).
#[napi]
pub fn serialize_handle(handle: &ArenaHandle) -> Result<Uint8Array> {
    let arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    Ok(Uint8Array::new(arena.to_raw_buffer()))
}

/// Render a handle's HAST arena to HTML. Does not consume the handle.
#[napi]
pub fn render_handle(handle: &ArenaHandle) -> Result<String> {
    let arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    Ok(satteri_ast::hast::hast_arena_to_html(&arena))
}

/// Compile a handle's HAST arena to MDX JavaScript. Does not consume the handle.
#[napi]
pub fn compile_handle(handle: &ArenaHandle, options: Option<JsMdxOptions>) -> Result<String> {
    let mut arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    let opts = js_options_to_rust(options);

    // Simplify plain MDX JSX elements (lowercase, no attrs) into HAST elements
    // so they can be collapsed by optimizeStatic.
    let ignore = opts
        .optimize_static
        .as_ref()
        .map(|c| c.ignore_elements.clone())
        .unwrap_or_default();
    satteri_mdxjs::simplify_plain_mdx_nodes(&mut arena, &ignore);

    satteri_mdxjs::compile_hast_arena(&arena, &opts)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Parse a JavaScript expression and return its ESTree-compatible AST as a JSON string.
/// Returns null if parsing fails. The JS layer calls JSON.parse (faster than serde_json → NAPI).
#[napi]
pub fn parse_expression(source: String) -> Option<String> {
    satteri_mdxjs::parse_expression_to_estree_json(&source)
}

/// Read the node_data JSON blob for a node. Returns null if none is set.
#[napi]
pub fn get_node_data(handle: &ArenaHandle, node_id: u32) -> Option<String> {
    let arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))
        .ok()?;
    let data = arena.get_node_data(node_id)?;
    String::from_utf8(data.to_vec()).ok()
}

/// Collect the concatenated text content of a HAST node and all its descendants.
/// Walks entirely in Rust, no per-child NAPI round-trips.
#[napi]
pub fn text_content_handle(handle: &ArenaHandle, node_id: u32) -> Result<String> {
    let arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    Ok(satteri_ast::hast::text_content(&arena, node_id))
}

/// Options for `mdast_text_content_handle`, matching `mdast-util-to-string`.
#[napi(object)]
pub struct JsTextContentOptions {
    /// Include `alt` text from image nodes. Default: true.
    pub include_image_alt: Option<bool>,
    /// Include `value` from HTML nodes. Default: true.
    pub include_html: Option<bool>,
}

/// Collect the concatenated text content of an MDAST node and all its descendants.
/// Mirrors `mdast-util-to-string`: collects value from text nodes, alt from images.
#[napi]
pub fn mdast_text_content_handle(
    handle: &ArenaHandle,
    node_id: u32,
    options: Option<JsTextContentOptions>,
) -> Result<String> {
    let arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    let opts = satteri_ast::mdast::TextContentOptions {
        include_image_alt: options
            .as_ref()
            .and_then(|o| o.include_image_alt)
            .unwrap_or(true),
        include_html: options
            .as_ref()
            .and_then(|o| o.include_html)
            .unwrap_or(true),
    };
    Ok(satteri_ast::mdast::text_content_with_options(
        &arena, node_id, &opts,
    ))
}

/// Release the arena memory held by a handle. The handle becomes empty
/// but remains valid (subsequent calls are no-ops or return empty results).
#[napi]
pub fn drop_handle(handle: &ArenaHandle) -> Result<()> {
    let mut arena = handle
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {e}")))?;
    *arena = satteri_arena::Arena::new(String::new());
    Ok(())
}
