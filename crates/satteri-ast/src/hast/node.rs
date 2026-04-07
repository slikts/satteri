//! HAST node type discriminants.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum HastNodeType {
    Root = 0,
    Element = 1,
    Text = 2,
    Comment = 3,
    Doctype = 4,
    Raw = 5,
    // MDX-specific HAST node types
    MdxJsxElement = 10,
    MdxJsxTextElement = 11,
    MdxFlowExpression = 12,
    MdxEsm = 13,
    MdxTextExpression = 14,
}

impl HastNodeType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(HastNodeType::Root),
            1 => Some(HastNodeType::Element),
            2 => Some(HastNodeType::Text),
            3 => Some(HastNodeType::Comment),
            4 => Some(HastNodeType::Doctype),
            5 => Some(HastNodeType::Raw),
            10 => Some(HastNodeType::MdxJsxElement),
            11 => Some(HastNodeType::MdxJsxTextElement),
            12 => Some(HastNodeType::MdxFlowExpression),
            13 => Some(HastNodeType::MdxEsm),
            14 => Some(HastNodeType::MdxTextExpression),
            _ => None,
        }
    }
}
