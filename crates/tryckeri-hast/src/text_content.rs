//! `textContent` — collect the concatenated text of all descendant text nodes.
//!
//! Mirrors DOM `textContent`: only text nodes (type 2) and MDX expression
//! values (types 12, 14) contribute. Comments and raw HTML are skipped.

use tryckeri_arena::Arena;

use crate::node_types::{HAST_MDX_FLOW_EXPRESSION, HAST_MDX_TEXT_EXPRESSION, HAST_TEXT};

/// Collect the concatenated text content of `node_id` and all its descendants.
///
/// Text nodes and MDX expression nodes contribute their `value`; other node
/// types are transparent (children are visited). Comments and raw HTML are
/// skipped, matching DOM `textContent` semantics.
pub fn text_content(arena: &Arena, node_id: u32) -> String {
    let mut out = String::new();
    collect(arena, node_id, &mut out);
    out
}

fn collect(arena: &Arena, node_id: u32, out: &mut String) {
    let node = arena.get_node(node_id);
    let nt = node.node_type;

    if nt == HAST_TEXT || nt == HAST_MDX_FLOW_EXPRESSION || nt == HAST_MDX_TEXT_EXPRESSION {
        let td = arena.get_type_data(node_id);
        if td.len() >= 8 {
            let offset = u32::from_le_bytes(td[0..4].try_into().unwrap()) as usize;
            let len = u32::from_le_bytes(td[4..8].try_into().unwrap()) as usize;
            out.push_str(&arena.source()[offset..offset + len]);
        }
        return;
    }

    for &child_id in arena.get_children(node_id) {
        collect(arena, child_id, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tryckeri_arena::ArenaBuilder;

    fn make_text_type_data(builder: &mut ArenaBuilder, text: &str) -> Vec<u8> {
        let sr = builder.alloc_string(text);
        let mut td = [0u8; 8];
        td[0..4].copy_from_slice(&sr.offset.to_le_bytes());
        td[4..8].copy_from_slice(&sr.len.to_le_bytes());
        td.to_vec()
    }

    #[test]
    fn single_text_node() {
        let mut b = ArenaBuilder::new(String::new());
        b.open_node_raw(0); // root
        b.open_node_raw(2); // text
        let td = make_text_type_data(&mut b, "hello");
        b.set_data_current(&td);
        b.close_node();
        b.close_node();
        let arena = b.finish();
        assert_eq!(text_content(&arena, 0), "hello");
        assert_eq!(text_content(&arena, 1), "hello");
    }

    #[test]
    fn nested_elements_with_text() {
        let mut b = ArenaBuilder::new(String::new());
        b.open_node_raw(0); // root
        // element
        b.open_node_raw(1);
        {
            // text "Hello "
            b.open_node_raw(2);
            let td = make_text_type_data(&mut b, "Hello ");
            b.set_data_current(&td);
            b.close_node();
            // nested element
            b.open_node_raw(1);
            {
                b.open_node_raw(2);
                let td = make_text_type_data(&mut b, "world");
                b.set_data_current(&td);
                b.close_node();
            }
            b.close_node();
        }
        b.close_node();
        b.close_node();
        let arena = b.finish();
        assert_eq!(text_content(&arena, 0), "Hello world");
    }

    #[test]
    fn skips_comments_and_raw() {
        let mut b = ArenaBuilder::new(String::new());
        b.open_node_raw(0); // root
        // text
        b.open_node_raw(2);
        let td = make_text_type_data(&mut b, "a");
        b.set_data_current(&td);
        b.close_node();
        // comment (type 3) — should be skipped
        b.open_node_raw(3);
        let td = make_text_type_data(&mut b, "COMMENT");
        b.set_data_current(&td);
        b.close_node();
        // raw (type 5) — should be skipped
        b.open_node_raw(5);
        let td = make_text_type_data(&mut b, "RAW");
        b.set_data_current(&td);
        b.close_node();
        // text
        b.open_node_raw(2);
        let td = make_text_type_data(&mut b, "b");
        b.set_data_current(&td);
        b.close_node();
        b.close_node();
        let arena = b.finish();
        assert_eq!(text_content(&arena, 0), "ab");
    }

    #[test]
    fn includes_mdx_expressions() {
        let mut b = ArenaBuilder::new(String::new());
        b.open_node_raw(0); // root
        // text
        b.open_node_raw(2);
        let td = make_text_type_data(&mut b, "Hello ");
        b.set_data_current(&td);
        b.close_node();
        // mdx text expression (type 14)
        b.open_node_raw(14);
        let td = make_text_type_data(&mut b, "frontmatter.name");
        b.set_data_current(&td);
        b.close_node();
        b.close_node();
        let arena = b.finish();
        assert_eq!(text_content(&arena, 0), "Hello frontmatter.name");
    }
}
