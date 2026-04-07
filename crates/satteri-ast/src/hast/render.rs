//! Render a HAST arena to an HTML string.

use satteri_arena::Arena;

use crate::hast::codec::{
    decode_element_prop, decode_element_prop_count, decode_element_tag, decode_text_data,
};
use crate::hast::HastNodeType;
use crate::shared::{PROP_BOOL_FALSE, PROP_BOOL_TRUE, PROP_COMMA_SEP, PROP_SPACE_SEP, PROP_STRING};

/// Render HTML from an arena.
pub fn hast_arena_to_html(arena: &Arena) -> String {
    let mut out = String::with_capacity(arena.source().len());
    render_node(0, arena, &mut out);
    out
}

/// Render a HAST node subtree to HTML.
pub fn render_node(node_id: u32, view: &Arena, out: &mut String) {
    let node = view.get_node(node_id);

    let Some(node_type) = HastNodeType::from_u8(node.node_type) else {
        for &child_id in view.get_children(node_id) {
            render_node(child_id, view, out);
        }
        return;
    };

    match node_type {
        HastNodeType::Root => {
            for &child_id in view.get_children(node_id) {
                render_node(child_id, view, out);
            }
        }

        HastNodeType::Element => {
            let data = view.get_type_data(node_id);
            if data.len() < 16 {
                return;
            }
            let tag_ref = decode_element_tag(data);
            let tag = view.get_str(tag_ref);

            out.push('<');
            out.push_str(tag);

            let prop_count = decode_element_prop_count(data);
            for i in 0..prop_count {
                let (name_ref, value_kind, value_ref) = decode_element_prop(data, i);
                let name = view.get_str(name_ref);
                match value_kind {
                    PROP_BOOL_TRUE => {
                        out.push(' ');
                        out.push_str(name);
                    }
                    PROP_BOOL_FALSE => {}
                    PROP_STRING | PROP_SPACE_SEP | PROP_COMMA_SEP => {
                        let value = view.get_str(value_ref);
                        out.push(' ');
                        out.push_str(name);
                        out.push_str("=\"");
                        pulldown_cmark_escape::escape_html(&mut *out, value).unwrap();
                        out.push('"');
                    }
                    _ => {}
                }
            }

            if is_void_element(tag) {
                out.push('>');
            } else {
                out.push('>');
                // Block containers emit \n after opening tag
                if is_block_container(tag) {
                    out.push('\n');
                }
                for &child_id in view.get_children(node_id) {
                    render_node(child_id, view, out);
                }
                out.push_str("</");
                out.push_str(tag);
                out.push('>');
            }
            // Block elements emit \n after closing tag
            if is_block_element(tag) {
                out.push('\n');
            }
        }

        HastNodeType::Text => {
            let data = view.get_type_data(node_id);
            if data.len() >= 8 {
                let sr = decode_text_data(data);
                let text = view.get_str(sr);
                // Skip newline-only text nodes inserted by the mdast->hast converter
                // as spacing between block siblings (needed for MDX, not for HTML)
                if !text.chars().all(|c| c == '\n') {
                    pulldown_cmark_escape::escape_html_body_text(&mut *out, text).unwrap();
                }
            }
        }

        HastNodeType::Comment => {
            let data = view.get_type_data(node_id);
            if data.len() >= 8 {
                let sr = decode_text_data(data);
                let text = view.get_str(sr);
                out.push_str("<!--");
                out.push_str(text);
                out.push_str("-->");
            }
        }

        HastNodeType::Doctype => {
            out.push_str("<!doctype html>");
        }

        HastNodeType::Raw => {
            let data = view.get_type_data(node_id);
            if data.len() >= 8 {
                let sr = decode_text_data(data);
                let html = view.get_str(sr);
                out.push_str(html);
            }
        }

        HastNodeType::MdxJsxElement
        | HastNodeType::MdxJsxTextElement
        | HastNodeType::MdxFlowExpression
        | HastNodeType::MdxTextExpression
        | HastNodeType::MdxEsm => {}
    }
}

fn is_void_element(tag: &str) -> bool {
    matches!(
        tag,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

/// Block elements that emit \n after their closing tag.
fn is_block_element(tag: &str) -> bool {
    matches!(
        tag,
        "blockquote"
            | "dd"
            | "details"
            | "div"
            | "dl"
            | "dt"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "hr"
            | "li"
            | "ol"
            | "p"
            | "pre"
            | "table"
            | "ul"
    )
}

/// Block containers that emit \n after their opening tag.
fn is_block_container(tag: &str) -> bool {
    matches!(tag, "blockquote" | "ol" | "ul" | "dl")
}
