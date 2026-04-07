//! Shared types for the binary command buffer system.
//!
//! The command dispatch logic lives in `satteri_plugin_api::js_commands`.
//! This module defines the shared error type, JS node representation,
//! and property-type constants that are used by both MDAST and HAST
//! command handlers.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct JsNode {
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default)]
    pub children: Option<Vec<JsNode>>,
    pub depth: Option<u8>,
    pub value: Option<String>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub alt: Option<String>,
    pub lang: Option<String>,
    pub meta: Option<String>,
    pub ordered: Option<bool>,
    pub start: Option<u32>,
    pub spread: Option<bool>,
    pub checked: Option<bool>,
    pub identifier: Option<String>,
    pub label: Option<String>,
    #[serde(rename = "referenceType")]
    pub reference_type: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub attributes: Option<Vec<JsNodeAttribute>>,
    // HAST-specific fields
    #[serde(rename = "tagName")]
    pub tag_name: Option<String>,
    #[serde(default)]
    pub properties: Option<serde_json::Map<String, serde_json::Value>>,
    /// Marker: when true, this node is a HAST node (not MDAST).
    #[serde(rename = "_hast", default)]
    pub is_hast: bool,
    /// When true, keep the original node's children instead of replacing them.
    #[serde(rename = "_keepChildren", default)]
    pub keep_children: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum JsNodeAttribute {
    #[serde(rename = "mdxJsxAttribute")]
    Attribute {
        name: String,
        /// null → boolean, string → literal, object with `value` → expression
        value: Option<serde_json::Value>,
    },
    #[serde(rename = "mdxJsxExpressionAttribute")]
    ExpressionAttribute { value: String },
}

#[derive(Debug)]
pub enum CommandError {
    UnexpectedEof,
    UnknownCommand(u8),
    UnknownPayloadType(u8),
    InvalidUtf8,
    InvalidJson(String),
    UnknownNodeType(String),
    UnknownField(u16),
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnexpectedEof => write!(f, "unexpected end of command buffer"),
            Self::UnknownCommand(c) => write!(f, "unknown command byte: 0x{c:02x}"),
            Self::UnknownPayloadType(p) => write!(f, "unknown payload type: 0x{p:02x}"),
            Self::InvalidUtf8 => write!(f, "invalid UTF-8 in command buffer"),
            Self::InvalidJson(e) => write!(f, "invalid JSON in command payload: {e}"),
            Self::UnknownNodeType(t) => write!(f, "unknown node type in JSON: {t}"),
            Self::UnknownField(f_id) => write!(f, "unknown field ID: 0x{f_id:04x}"),
        }
    }
}

impl std::error::Error for CommandError {}
