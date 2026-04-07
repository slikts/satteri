//! HTML output tests: verify that mdast_to_html produces correct HTML
//! for all supported Markdown constructs.

use satteri_ast::mdast_to_html;

fn html(md: &str) -> String {
    let (arena, _errors) =
        satteri_pulldown_cmark::parse(md, satteri_pulldown_cmark::DEFAULT_OPTIONS);
    mdast_to_html(&arena)
}

#[test]
fn heading_h1() {
    assert_eq!(html("# Heading 1"), "<h1>Heading 1</h1>\n");
}

#[test]
fn heading_h2() {
    assert_eq!(html("## Heading 2"), "<h2>Heading 2</h2>\n");
}

#[test]
fn heading_h6() {
    assert_eq!(html("###### Heading 6"), "<h6>Heading 6</h6>\n");
}

#[test]
fn paragraph() {
    assert_eq!(html("A simple paragraph."), "<p>A simple paragraph.</p>\n");
}

#[test]
fn emphasis() {
    assert_eq!(
        html("Some *emphasized* text."),
        "<p>Some <em>emphasized</em> text.</p>\n"
    );
}

#[test]
fn strong() {
    assert_eq!(
        html("Some **strong** text."),
        "<p>Some <strong>strong</strong> text.</p>\n"
    );
}

#[test]
fn inline_code() {
    assert_eq!(
        html("Use `inline code` here."),
        "<p>Use <code>inline code</code> here.</p>\n"
    );
}

#[test]
fn link_without_title() {
    assert_eq!(
        html("[example](https://example.com)"),
        "<p><a href=\"https://example.com\">example</a></p>\n"
    );
}

#[test]
fn link_with_title() {
    assert_eq!(
        html("[example](https://example.com \"Example Title\")"),
        "<p><a href=\"https://example.com\" title=\"Example Title\">example</a></p>\n"
    );
}

#[test]
fn image_without_title() {
    assert_eq!(
        html("![alt text](image.png)"),
        "<p><img src=\"image.png\" alt=\"alt text\"></p>\n"
    );
}

#[test]
fn fenced_code_block() {
    assert_eq!(
        html("```rust\nfn main() {}\n```"),
        "<pre><code class=\"language-rust\">fn main() {}\n</code></pre>\n"
    );
}

#[test]
fn code_block_no_language() {
    assert_eq!(
        html("```\nplain code\n```"),
        "<pre><code>plain code\n</code></pre>\n"
    );
}

#[test]
fn blockquote() {
    assert_eq!(
        html("> This is a blockquote."),
        "<blockquote>\n<p>This is a blockquote.</p>\n</blockquote>\n"
    );
}

#[test]
fn unordered_list() {
    assert_eq!(
        html("- Item 1\n- Item 2\n- Item 3"),
        "<ul>\n<li>Item 1</li>\n<li>Item 2</li>\n<li>Item 3</li>\n</ul>\n"
    );
}

#[test]
fn ordered_list() {
    assert_eq!(
        html("1. First\n2. Second\n3. Third"),
        "<ol>\n<li>First</li>\n<li>Second</li>\n<li>Third</li>\n</ol>\n"
    );
}

#[test]
fn table() {
    let result = html("| A | B |\n|---|---|\n| 1 | 2 |");
    assert!(result.contains("<table>"));
    assert!(result.contains("<th>A</th>"));
    assert!(result.contains("<td>1</td>"));
}

#[test]
fn thematic_break() {
    assert_eq!(html("---"), "<hr>\n");
}

#[test]
fn hard_line_break() {
    assert_eq!(
        html("Line one  \nLine two"),
        "<p>Line one<br>Line two</p>\n"
    );
}

#[test]
fn text_escaping() {
    assert_eq!(html("a < b & c > d"), "<p>a &lt; b &amp; c &gt; d</p>\n");
}

#[test]
fn multiple_paragraphs() {
    assert_eq!(
        html("First paragraph.\n\nSecond paragraph."),
        "<p>First paragraph.</p>\n<p>Second paragraph.</p>\n"
    );
}
