//! Copy as vector (roadmap 23): a graph or layout page on the system clipboard as one pasteboard
//! item with several representations — PDF (vector, fonts embedded; what Illustrator, Word,
//! PowerPoint and Keynote paste as editable artwork), PNG (a high-resolution fallback) and the
//! SVG itself. All three are made by the webview, the PDF by the app's own writer as for PDF
//! export (roadmap 27). macOS only; elsewhere the webview's clipboard API is used instead.

/// Request headers giving the SVG's and the PNG's lengths in bytes; the body is the SVG, the PNG,
/// then the PDF.
pub const SVG_LENGTH_HEADER: &str = "x-svg-length";
pub const PNG_LENGTH_HEADER: &str = "x-png-length";

/// Pasteboard types (UTIs), in order of preference for the apps pasting.
pub const PDF_TYPE: &str = "com.adobe.pdf";
pub const PNG_TYPE: &str = "public.png";
pub const SVG_TYPE: &str = "public.svg-image";

/// The graphics of one copy, as the webview sent them.
pub struct Payload<'a> {
    pub svg: &'a str,
    pub png: &'a [u8],
    pub pdf: &'a [u8],
}

/// Splits a request body into the SVG text, the PNG and the PDF, checking each is what it says.
pub fn split_payload(body: &[u8], svg_len: usize, png_len: usize) -> Result<Payload<'_>, String> {
    match svg_len.checked_add(png_len) {
        Some(n) if n <= body.len() => {}
        _ => return Err("clipboard payload shorter than its SVG and PNG".into()),
    }
    let (svg, rest) = body.split_at(svg_len);
    let (png, pdf) = rest.split_at(png_len);
    let svg = std::str::from_utf8(svg).map_err(|_| "the SVG is not UTF-8".to_string())?;
    if !svg.trim_start().starts_with("<svg") {
        return Err("not an SVG".into());
    }
    if !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("not a PNG".into());
    }
    if !pdf.starts_with(b"%PDF-") {
        return Err("not a PDF".into());
    }
    Ok(Payload { svg, png, pdf })
}

/// The representations written, most capable first: the PDF, the PNG, the SVG text.
pub fn representations(p: &Payload<'_>) -> Vec<(&'static str, Vec<u8>)> {
    vec![
        (PDF_TYPE, p.pdf.to_vec()),
        (PNG_TYPE, p.png.to_vec()),
        (SVG_TYPE, p.svg.as_bytes().to_vec()),
    ]
}

#[cfg(target_os = "macos")]
pub mod pasteboard {
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSData, NSString};

    pub fn general() -> Retained<NSPasteboard> {
        NSPasteboard::generalPasteboard()
    }

    /// Replaces the pasteboard's contents with one item holding every representation; returns
    /// the pasteboard's change count afterwards (to tell later whether it is still ours).
    pub fn write(pb: &NSPasteboard, reps: &[(&str, Vec<u8>)]) -> Result<isize, String> {
        let item = NSPasteboardItem::new();
        for (ty, bytes) in reps {
            let data = NSData::with_bytes(bytes);
            if !item.setData_forType(&data, &NSString::from_str(ty)) {
                return Err(format!("the clipboard refused {ty}"));
            }
        }
        pb.clearContents();
        let objects: Retained<NSArray<ProtocolObject<dyn NSPasteboardWriting>>> =
            NSArray::from_retained_slice(&[ProtocolObject::from_retained(item)]);
        if !pb.writeObjects(&objects) {
            return Err("writing to the clipboard failed".into());
        }
        Ok(pb.changeCount())
    }

    pub fn change_count(pb: &NSPasteboard) -> isize {
        pb.changeCount()
    }

    /// The types on the pasteboard (tests).
    #[cfg(test)]
    pub fn types(pb: &NSPasteboard) -> Vec<String> {
        pb.types()
            .map(|a| a.to_vec().iter().map(|t| t.to_string()).collect())
            .unwrap_or_default()
    }

    /// The data of one type (tests).
    #[cfg(test)]
    pub fn data(pb: &NSPasteboard, ty: &str) -> Option<Vec<u8>> {
        pb.dataForType(&NSString::from_str(ty)).map(|d| d.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="72pt" height="36pt" viewBox="0 0 72 36"><rect x="0" y="0" width="72" height="36" fill="#ffffff"/></svg>"##;
    // Headers are enough here: the bytes are passed through.
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const PDF: &[u8] = b"%PDF-1.7\n%%EOF\n";

    fn body() -> Vec<u8> {
        [SVG.as_bytes(), PNG, PDF].concat()
    }

    #[test]
    fn splits_the_payload() {
        let b = body();
        let p = split_payload(&b, SVG.len(), PNG.len()).unwrap();
        assert_eq!(p.svg, SVG);
        assert_eq!(p.png, PNG);
        assert_eq!(p.pdf, PDF);
        assert!(split_payload(&b, b.len(), 1).is_err(), "longer than the body");
        assert!(split_payload(&b, usize::MAX, 2).is_err(), "overflowing lengths");
        assert!(split_payload(&b, 3, PNG.len()).is_err(), "SVG cut short");
        assert!(
            split_payload(&b, SVG.len(), PNG.len() - 1).is_err(),
            "the PDF doesn't start where it should"
        );
        let mut bad = b.clone();
        bad[SVG.len()] = 0;
        assert!(split_payload(&bad, SVG.len(), PNG.len()).is_err(), "not a PNG");
    }

    #[test]
    fn representations_are_pdf_png_svg() {
        let b = body();
        let reps = representations(&split_payload(&b, SVG.len(), PNG.len()).unwrap());
        let types: Vec<_> = reps.iter().map(|(t, _)| *t).collect();
        assert_eq!(types, [PDF_TYPE, PNG_TYPE, SVG_TYPE]);
        assert_eq!(reps[0].1, PDF);
        assert_eq!(reps[1].1, PNG);
        assert_eq!(reps[2].1, SVG.as_bytes());
    }

    /// Writes the given bytes to a private pasteboard (never the user's clipboard) and reads the
    /// types back.
    #[cfg(target_os = "macos")]
    #[test]
    fn writes_one_item_with_every_type() {
        use objc2_app_kit::NSPasteboard;
        let pb = NSPasteboard::pasteboardWithUniqueName();
        let before = pasteboard::change_count(&pb);
        let b = body();
        let reps = representations(&split_payload(&b, SVG.len(), PNG.len()).unwrap());
        let count = pasteboard::write(&pb, &reps).unwrap();
        assert_ne!(count, before);
        assert_eq!(pasteboard::change_count(&pb), count);
        let types = pasteboard::types(&pb);
        for t in [PDF_TYPE, PNG_TYPE, SVG_TYPE] {
            assert!(types.iter().any(|x| x == t), "{t} missing from {types:?}");
        }
        assert_eq!(pasteboard::data(&pb, SVG_TYPE).unwrap(), SVG.as_bytes());
        assert_eq!(pasteboard::data(&pb, PDF_TYPE).unwrap(), PDF);
    }
}

