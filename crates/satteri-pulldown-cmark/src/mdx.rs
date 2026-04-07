use memchr::memchr;

use crate::{
    firstpass::FirstPass,
    parse::{Item, ItemBody},
};

// Helpers

/// Check if from `start` to the next newline (or EOF) there are only spaces/tabs.
fn is_only_whitespace_to_eol(bytes: &[u8]) -> bool {
    for &b in bytes {
        match b {
            b' ' | b'\t' => continue,
            b'\n' | b'\r' => return true,
            _ => return false,
        }
    }
    true // EOF counts
}

/// Scan to the end of a line, returning offset past the newline.
fn scan_to_line_end(bytes: &[u8], start: usize) -> Option<usize> {
    let eol = memchr(b'\n', &bytes[start..])
        .map(|i| start + i + 1)
        .unwrap_or(bytes.len());
    Some(eol)
}

/// Scan a JSX tag from `<` to `>` or `/>`, returning the byte offset
/// immediately after the closing `>`. Does NOT scan to EOL.
fn scan_mdx_jsx_tag_end(bytes: &[u8]) -> Option<usize> {
    let mut ix = 1; // skip `<`

    // Skip `/` for closing tags
    if ix < bytes.len() && bytes[ix] == b'/' {
        ix += 1;
    }

    // Fragment `<>` / `</>`
    if ix < bytes.len() && bytes[ix] == b'>' {
        return Some(ix + 1);
    }

    // Validate tag name: must start with letter, `_`, or `$`
    if ix >= bytes.len() {
        return None;
    }
    let first = bytes[ix];
    if !first.is_ascii_alphabetic() && first != b'_' && first != b'$' && first < 0x80 {
        return None;
    }
    ix += 1;

    // Scan tag name body
    while ix < bytes.len() {
        match bytes[ix] {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'$' => ix += 1,
            b':' => {
                ix += 1;
                if ix >= bytes.len() {
                    return None;
                }
                let ch = bytes[ix];
                if !ch.is_ascii_alphabetic() && ch != b'_' && ch != b'$' && ch < 0x80 {
                    return None;
                }
                ix += 1;
            }
            0x80.. => ix += 1,
            _ => break,
        }
    }

    // After tag name: must be whitespace, `>`, `/`, or `{`
    if ix < bytes.len() {
        match bytes[ix] {
            b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r' | b'{' => {}
            _ => return None,
        }
    }

    let mut brace_depth: usize = 0;
    while ix < bytes.len() {
        match bytes[ix] {
            b'>' if brace_depth == 0 => {
                return Some(ix + 1);
            }
            b'/' if ix + 1 < bytes.len() && bytes[ix + 1] == b'>' && brace_depth == 0 => {
                return Some(ix + 2);
            }
            b'{' => {
                brace_depth += 1;
                ix += 1;
            }
            b'}' => {
                brace_depth = brace_depth.saturating_sub(1);
                ix += 1;
            }
            b'"' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'"' {
                    if bytes[ix] == b'\\' {
                        ix += 1;
                    }
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                } // skip closing quote
            }
            b'\'' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'\'' {
                    if bytes[ix] == b'\\' {
                        ix += 1;
                    }
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            b'`' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'`' {
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            b'\n' | b'\r' => {
                // Multi-line JSX: keep scanning
                ix += 1;
                if ix < bytes.len() && bytes[ix - 1] == b'\r' && bytes[ix] == b'\n' {
                    ix += 1;
                }
            }
            _ => ix += 1,
        }
    }
    None // Unclosed tag
}

// Public scanners

/// Scan for an MDX ESM line (`import ...` or `export ...`).
/// Returns the byte offset past the end of the line (including newline) if matched.
pub(crate) fn scan_mdx_esm(bytes: &[u8]) -> Option<usize> {
    let is_import = bytes.starts_with(b"import ")
        || bytes.starts_with(b"import\t")
        || bytes.starts_with(b"import{");
    let is_export = bytes.starts_with(b"export ")
        || bytes.starts_with(b"export\t")
        || bytes.starts_with(b"export{")
        || bytes.starts_with(b"export*")
        || bytes.starts_with(b"export\n")
        || bytes.starts_with(b"export\r");

    if !is_import && !is_export {
        return None;
    }

    // Consume the rest of the line (and any continuation lines for multi-line imports).
    let mut ix = 0;
    loop {
        // Find end of current line.
        let eol = memchr(b'\n', &bytes[ix..])
            .map(|i| ix + i + 1)
            .unwrap_or(bytes.len());
        ix = eol;
        // Check for continuation: next line that doesn't start a new block.
        // Simple heuristic: line continuation if previous line ends with `,` or `{` or `(` or `from`
        // before whitespace/newline, or next line starts with whitespace.
        if ix < bytes.len() && (bytes[ix] == b' ' || bytes[ix] == b'\t') {
            continue;
        }
        // Also continue if the last non-whitespace char before the newline suggests continuation.
        let prev_end = if ix >= 2 && bytes[ix - 2] == b'\r' {
            ix - 2
        } else {
            ix - 1
        };
        let last_significant = bytes[..prev_end]
            .iter()
            .rposition(|&b| b != b' ' && b != b'\t');
        if let Some(pos) = last_significant {
            match bytes[pos] {
                b',' | b'{' | b'(' => {
                    if ix < bytes.len() {
                        continue;
                    }
                }
                _ => {}
            }
        }
        break;
    }
    Some(ix)
}

/// Check if `<` starts a **block-level** MDX JSX element.
/// A block JSX element must be the only significant content on the line
/// (possibly followed only by whitespace). If there's trailing text, it's
/// inline JSX inside a paragraph instead.
///
/// Returns byte offset past the element (including trailing newline) if matched.
pub(crate) fn scan_mdx_jsx_block(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 2 || bytes[0] != b'<' {
        return None;
    }

    let is_closing = bytes[1] == b'/';
    let name_start = if is_closing { 2 } else { 1 };

    if name_start >= bytes.len() {
        return None;
    }

    // Fragment: `<>` or `</>`
    if bytes[name_start] == b'>' {
        let after = name_start + 1;
        return if is_only_whitespace_to_eol(&bytes[after..]) {
            scan_to_line_end(bytes, after)
        } else {
            None // trailing content → inline
        };
    }

    // Tag name must start with an ASCII letter or `_`
    let first = bytes[name_start];
    if !first.is_ascii_alphabetic() && first != b'_' && first != b'$' && first < 0x80 {
        return None;
    }

    // Find the end of the first tag, then allow more tags or expressions
    // on the same line (e.g., `<a></a>`, `<a/>{1}`, `{1}<a/>`).
    let mut pos = scan_mdx_jsx_tag_end(bytes)?;

    // Consume any subsequent tags or expressions on the same line.
    loop {
        // Skip whitespace
        while pos < bytes.len() && (bytes[pos] == b' ' || bytes[pos] == b'\t') {
            pos += 1;
        }
        if pos >= bytes.len() || bytes[pos] == b'\n' || bytes[pos] == b'\r' {
            break; // EOL, valid flow
        }
        // Try another JSX tag
        if bytes[pos] == b'<' {
            if let Some(end) = scan_mdx_jsx_tag_end(&bytes[pos..]) {
                pos += end;
                continue;
            }
        }
        // Try an expression
        if bytes[pos] == b'{' {
            if let Some((_, _, len)) = scan_mdx_inline_expression(&bytes[pos..]) {
                pos += len;
                continue;
            }
        }
        // Something else follows, not a flow element
        return None;
    }

    scan_to_line_end(bytes, pos)
}

/// Scan for an MDX expression block: `{...}` with balanced braces.
/// Returns byte offset past the end (including trailing newline).
pub(crate) fn scan_mdx_expression_block(bytes: &[u8]) -> Option<usize> {
    if bytes.is_empty() || bytes[0] != b'{' {
        return None;
    }

    let mut ix = 1;
    let mut depth: usize = 1;

    while ix < bytes.len() && depth > 0 {
        match bytes[ix] {
            b'{' => {
                depth += 1;
                ix += 1;
            }
            b'}' => {
                depth -= 1;
                ix += 1;
            }
            b'"' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'"' {
                    if bytes[ix] == b'\\' {
                        ix += 1;
                    }
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            b'\'' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'\'' {
                    if bytes[ix] == b'\\' {
                        ix += 1;
                    }
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            b'`' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'`' {
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            _ => ix += 1,
        }
    }

    if depth == 0 {
        // Block-level expression: only whitespace or JSX tags may follow.
        // Multiple expressions on one line (like `{1} {2}`) should be inline.
        if !is_only_whitespace_to_eol(&bytes[ix..]) {
            return None;
        }
        // Skip newline
        while ix < bytes.len() && (bytes[ix] == b' ' || bytes[ix] == b'\t') {
            ix += 1;
        }
        if ix < bytes.len() && bytes[ix] == b'\r' {
            ix += 1;
        }
        if ix < bytes.len() && bytes[ix] == b'\n' {
            ix += 1;
        }
        Some(ix)
    } else {
        None
    }
}

/// Scan an inline MDX expression: `{...}` with balanced braces.
/// Returns (content_start, content_end, total_len) where content excludes the outer braces.
pub(crate) fn scan_mdx_inline_expression(bytes: &[u8]) -> Option<(usize, usize, usize)> {
    if bytes.is_empty() || bytes[0] != b'{' {
        return None;
    }

    let mut ix = 1;
    let mut depth: usize = 1;

    while ix < bytes.len() && depth > 0 {
        match bytes[ix] {
            b'{' => {
                depth += 1;
                ix += 1;
            }
            b'}' => {
                depth -= 1;
                ix += 1;
            }
            b'"' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'"' {
                    if bytes[ix] == b'\\' {
                        ix += 1;
                    }
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            b'\'' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'\'' {
                    if bytes[ix] == b'\\' {
                        ix += 1;
                    }
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            b'`' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'`' {
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            _ => ix += 1,
        }
    }

    if depth == 0 {
        Some((1, ix - 1, ix))
    } else {
        None
    }
}

/// Scan an inline JSX tag from `<` to `>` or `/>`.
/// In MDX mode, ALL tags are JSX. Returns total byte length if matched.
pub(crate) fn scan_mdx_inline_jsx(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 2 || bytes[0] != b'<' {
        return None;
    }

    let is_closing = bytes[1] == b'/';
    let name_start = if is_closing { 2 } else { 1 };

    if name_start >= bytes.len() {
        return None;
    }

    // Fragment: `<>` or `</>`
    if bytes[name_start] == b'>' {
        return Some(name_start + 1);
    }

    // Must start with an ASCII letter, `_`, or `$`
    let first = bytes[name_start];
    if !first.is_ascii_alphabetic() && first != b'_' && first != b'$' && first < 0x80 {
        return None;
    }

    // Scan the tag name: letters, digits, `-`, `.` are valid name characters.
    let mut ix = name_start + 1;
    while ix < bytes.len() {
        match bytes[ix] {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'$' => ix += 1,
            // Namespace separator (e.g. `xml:space`): must be followed by a
            // valid name-start character.
            b':' => {
                ix += 1;
                if ix >= bytes.len() {
                    return None;
                }
                let ch = bytes[ix];
                if !ch.is_ascii_alphabetic() && ch != b'_' && ch != b'$' && ch < 0x80 {
                    return None;
                }
                ix += 1;
            }
            // Non-ASCII UTF-8 byte: allow (component names can use Unicode)
            0x80.. => ix += 1,
            _ => break,
        }
    }

    // After the tag name: must be whitespace, `>`, `/`, or `{`.
    // This rejects patterns like `<https://...>`.
    if ix < bytes.len() {
        match bytes[ix] {
            b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r' | b'{' => {}
            _ => return None,
        }
    }

    // Scan to closing `>` or `/>` handling balanced braces and strings
    let mut brace_depth: usize = 0;

    while ix < bytes.len() {
        match bytes[ix] {
            b'>' if brace_depth == 0 => return Some(ix + 1),
            b'/' if ix + 1 < bytes.len() && bytes[ix + 1] == b'>' && brace_depth == 0 => {
                return Some(ix + 2);
            }
            b'{' => {
                brace_depth += 1;
                ix += 1;
            }
            b'}' => {
                brace_depth = brace_depth.saturating_sub(1);
                ix += 1;
            }
            b'"' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'"' {
                    if bytes[ix] == b'\\' {
                        ix += 1;
                    }
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            b'\'' => {
                ix += 1;
                while ix < bytes.len() && bytes[ix] != b'\'' {
                    if bytes[ix] == b'\\' {
                        ix += 1;
                    }
                    ix += 1;
                }
                if ix < bytes.len() {
                    ix += 1;
                }
            }
            b'\n' | b'\r' => {
                // Multi-line JSX: keep scanning (attributes/values can span lines).
                ix += 1;
                if ix < bytes.len() && bytes[ix - 1] == b'\r' && bytes[ix] == b'\n' {
                    ix += 1;
                }
            }
            _ => ix += 1,
        }
    }
    None
}

// Block-level MDX parsers (methods on FirstPass)

impl<'a, 'b> FirstPass<'a, 'b> {
    pub(crate) fn parse_mdx_esm(&mut self, start_ix: usize, end_ix: usize) -> usize {
        let content = &self.text[start_ix..end_ix].trim_end();
        let cow_ix = self.allocs.allocate_cow((*content).into());
        self.tree.append(Item {
            start: start_ix,
            end: end_ix,
            body: ItemBody::MdxEsm(cow_ix),
        });
        end_ix
    }

    pub(crate) fn parse_mdx_jsx_flow(&mut self, start_ix: usize, end_ix: usize) -> usize {
        let raw = &self.text[start_ix..end_ix].trim_end();
        let jsx_data = parse_jsx_tag(raw);
        let jsx_ix = self.allocs.allocate_jsx_element(jsx_data);
        self.tree.append(Item {
            start: start_ix,
            end: end_ix,
            body: ItemBody::MdxJsxFlowElement(jsx_ix),
        });
        end_ix
    }

    pub(crate) fn parse_mdx_flow_expression(&mut self, start_ix: usize, end_ix: usize) -> usize {
        // Content is between the outer `{` and `}`.
        let raw = &self.text[start_ix..end_ix].trim_end();
        let inner = &raw[1..raw.len() - 1]; // strip `{` and `}`
        let cow_ix = self.allocs.allocate_cow(inner.into());
        self.tree.append(Item {
            start: start_ix,
            end: end_ix,
            body: ItemBody::MdxFlowExpression(cow_ix),
        });
        end_ix
    }
}

// JSX tag parser: extracts name, attributes, and tag classification

use crate::parse::{JsxAttr, JsxElementData};

/// Parse a raw JSX tag string into structured `JsxElementData`.
///
/// Handles opening, closing, self-closing tags, and fragments.
/// Attributes are extracted with zero-copy `CowStr::Borrowed` where possible.
pub(crate) fn parse_jsx_tag<'a>(raw: &'a str) -> JsxElementData<'a> {
    let s = raw.trim();

    // Closing tag: </Name>
    if let Some(rest) = s.strip_prefix("</") {
        let name = extract_tag_name(rest);
        return JsxElementData {
            name: name.into(),
            attrs: Vec::new(),
            raw: raw.into(),
            is_closing: true,
            is_self_closing: false,
        };
    }

    // Self-closing: ends with />
    let ends_self_close = s.ends_with("/>");

    // Extract name, skip leading '<'
    let name = extract_tag_name(&s[1..]);

    // Check for self-contained: <Name ...>...</Name> or <>...</>
    let is_self_contained = if !name.is_empty() {
        let close_tag = alloc::format!("</{name}>");
        s.contains(&*close_tag)
    } else {
        s.contains("</>")
    };

    let is_self_closing = ends_self_close || is_self_contained;

    // Parse attributes
    let attrs = parse_jsx_attrs(s);

    JsxElementData {
        name: name.into(),
        attrs,
        raw: raw.into(),
        is_closing: false,
        is_self_closing,
    }
}

fn extract_tag_name(s: &str) -> &str {
    let end = s
        .find(|c: char| c.is_whitespace() || c == '/' || c == '>' || c == '{')
        .unwrap_or(s.len());
    &s[..end]
}

/// Extract the opening tag portion (up to the first unbalanced `>`).
fn extract_opening_tag(text: &str) -> &str {
    let mut depth = 0i32;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_backtick = false;
    let mut prev = '\0';

    for (i, ch) in text.char_indices() {
        if in_single_quote {
            if ch == '\'' && prev != '\\' {
                in_single_quote = false;
            }
        } else if in_double_quote {
            if ch == '"' && prev != '\\' {
                in_double_quote = false;
            }
        } else if in_backtick {
            if ch == '`' && prev != '\\' {
                in_backtick = false;
            }
        } else {
            match ch {
                '\'' => in_single_quote = true,
                '"' => in_double_quote = true,
                '`' => in_backtick = true,
                '{' => depth += 1,
                '}' => depth -= 1,
                '>' if depth == 0 => return &text[..=i],
                _ => {}
            }
        }
        prev = ch;
    }
    text
}

fn parse_jsx_attrs<'a>(text: &'a str) -> Vec<JsxAttr<'a>> {
    let tag = extract_opening_tag(text);
    let bytes = tag.as_bytes();
    let len = bytes.len();

    let mut attrs = Vec::new();
    let mut i = 1; // skip '<'

    // Skip '/' for closing tags
    if i < len && bytes[i] == b'/' {
        i += 1;
    }

    // Skip whitespace
    while i < len && bytes[i].is_ascii_whitespace() {
        i += 1;
    }

    // Skip tag name
    while i < len
        && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'.' | b'-' | b':' | b'_'))
    {
        i += 1;
    }

    loop {
        // Skip whitespace
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= len {
            break;
        }
        if bytes[i] == b'>' || (bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'>') {
            break;
        }

        // Spread expression: {...expr}
        if bytes[i] == b'{' {
            i += 1;
            let start = i;
            let mut depth = 1i32;
            while i < len && depth > 0 {
                match bytes[i] {
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    b'\'' | b'"' | b'`' => {
                        let q = bytes[i];
                        i += 1;
                        while i < len && bytes[i] != q {
                            if bytes[i] == b'\\' {
                                i += 1;
                            }
                            i += 1;
                        }
                    }
                    _ => {}
                }
                i += 1;
            }
            let value = tag[start..i.saturating_sub(1)].trim();
            attrs.push(JsxAttr::Spread(value.into()));
            continue;
        }

        // Attribute name
        let name_start = i;
        while i < len
            && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'-' | b':' | b'_'))
        {
            i += 1;
        }
        if i == name_start {
            i += 1;
            continue;
        }
        let name = &tag[name_start..i];

        // Skip whitespace
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }

        if i < len && bytes[i] == b'=' {
            i += 1;
            while i < len && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i >= len {
                attrs.push(JsxAttr::Boolean(name.into()));
                continue;
            }
            if bytes[i] == b'"' || bytes[i] == b'\'' {
                let q = bytes[i];
                i += 1;
                let val_start = i;
                while i < len && bytes[i] != q {
                    if bytes[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
                let value = &tag[val_start..i];
                if i < len {
                    i += 1;
                }
                attrs.push(JsxAttr::Literal(name.into(), value.into()));
            } else if bytes[i] == b'{' {
                i += 1;
                let val_start = i;
                let mut depth = 1i32;
                while i < len && depth > 0 {
                    match bytes[i] {
                        b'{' => depth += 1,
                        b'}' => depth -= 1,
                        b'\'' | b'"' | b'`' => {
                            let q = bytes[i];
                            i += 1;
                            while i < len && bytes[i] != q {
                                if bytes[i] == b'\\' {
                                    i += 1;
                                }
                                i += 1;
                            }
                        }
                        _ => {}
                    }
                    i += 1;
                }
                let value = &tag[val_start..i.saturating_sub(1)];
                attrs.push(JsxAttr::Expression(name.into(), value.into()));
            } else {
                attrs.push(JsxAttr::Boolean(name.into()));
            }
        } else {
            attrs.push(JsxAttr::Boolean(name.into()));
        }
    }

    attrs
}
