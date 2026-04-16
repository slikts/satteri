extern crate satteri_mdxjs;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mdx = r#"export const components = { h1: CustomHeading }

# Hello
"#;

    let result = satteri_mdxjs::compile(mdx, &Default::default(), satteri_pulldown_cmark::MDX_OPTIONS)?;
    println!("{}", result);
    Ok(())
}
