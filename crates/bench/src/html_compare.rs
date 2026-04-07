fn main() {
    let sources = [
        "# Hello\n\nWorld",
        "## Heading 2\n\n### Heading 3",
        "Some **bold** and *italic* text",
        "[link](https://example.com)\n\n![alt](img.png)",
        "- item 1\n- item 2\n- item 3",
        "1. first\n2. second\n3. third",
        "> blockquote\n>\n> continued",
        "```rust\nfn main() {}\n```",
        "inline `code` here",
        "---\n\nparagraph",
        "| a | b |\n|---|---|\n| 1 | 2 |",
        "- [x] done\n- [ ] todo",
        "text with a [link](url \"title\") here",
        "![image](src \"title\")",
        "***bold and italic***",
        "~~deleted~~",
        "just text",
        "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6",
    ];

    let opts = satteri_pulldown_cmark::DEFAULT_OPTIONS;
    let mut diffs = 0;
    for (i, source) in sources.iter().enumerate() {
        // push_html path
        let parser = satteri_pulldown_cmark::Parser::new_ext(source, opts);
        let mut push = String::new();
        satteri_pulldown_cmark::html::push_html(&mut push, parser);

        // arena path
        let (arena, _) = satteri_pulldown_cmark::parse(source, opts);
        let arena_html = satteri_ast::mdast_to_html(&arena);

        if push != arena_html {
            diffs += 1;
            eprintln!("DIFF #{} (source #{}):", diffs, i);
            eprintln!("  Input: {:?}", source);
            eprintln!("  push_html: {:?}", push);
            eprintln!("  arena:     {:?}", arena_html);
            eprintln!();
        }
    }

    if diffs == 0 {
        println!("All {} test cases produce identical HTML.", sources.len());
    } else {
        eprintln!(
            "{} differences found out of {} cases.",
            diffs,
            sources.len()
        );
        std::process::exit(1);
    }
}
