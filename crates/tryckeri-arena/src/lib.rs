//! `tryckeri-arena` — generic arena-allocated tree structure.
//!
//! Provides the core data structures shared by MDAST and HAST:
//! - `Arena` for owning all nodes and associated data
//! - `ArenaBuilder` for incremental tree construction
//! - `ArenaNode` and `StringRef` for zero-copy node representation
//! - `ReadArena` trait for read-only access
//! - Raw buffer export/import for binary transfer
//! - `LineIndex` for offset→(line, column) conversion

pub mod arena;
pub mod builder;
pub mod codec;
pub mod line_index;
pub mod mdx_types;
pub mod node;
pub mod raw_buffer;
pub mod read_arena;

pub use arena::Arena;
pub use builder::ArenaBuilder;
pub use codec::{decode_string_ref_data, encode_string_ref_data};
pub use line_index::LineIndex;
pub use node::{ArenaNode, StringRef, NODE_STRUCT_SIZE};
pub use raw_buffer::{BufferError, BufferHeader, BUFFER_MAGIC, BUFFER_VERSION};
pub use read_arena::ReadArena;
