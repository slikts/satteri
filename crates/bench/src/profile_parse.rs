/// Profiling binary: hammers `satteri_pulldown_cmark::parse` in a tight loop so perf/flamegraph
/// gets enough samples to show a meaningful call graph.
///
/// Run via: cargo flamegraph -p satteri-bench --bin profile_parse
fn main() {
    let src = include_str!("../fixtures/markdown.md");
    let opts = satteri_pulldown_cmark::DEFAULT_OPTIONS;

    // Warm up to avoid cold-start noise.
    for _ in 0..100 {
        let _ = satteri_pulldown_cmark::parse(src, opts);
    }

    // Profile window, enough iterations for ~5s of samples.
    for _ in 0..50_000 {
        let arena = satteri_pulldown_cmark::parse(src, opts);
        std::hint::black_box(arena);
    }
}
