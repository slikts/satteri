//! Generic codec helpers for arena type-data encoding.

use crate::node::StringRef;

/// # Safety
/// `T` must be a `Copy`, `#[repr(C)]` type with no padding-dependent invariants.
pub unsafe fn struct_to_bytes<T: Copy>(val: &T) -> &[u8] {
    std::slice::from_raw_parts(val as *const T as *const u8, std::mem::size_of::<T>())
}

/// # Safety
/// `bytes` must be at least `size_of::<T>()` bytes. `T` must be a `Copy`,
/// `#[repr(C)]` type. Alignment is not required (data is copied).
pub unsafe fn bytes_to_struct<T: Copy>(bytes: &[u8]) -> T {
    assert!(
        bytes.len() >= std::mem::size_of::<T>(),
        "bytes_to_struct: buffer too small ({} < {})",
        bytes.len(),
        std::mem::size_of::<T>()
    );
    let mut val = std::mem::MaybeUninit::<T>::uninit();
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), val.as_mut_ptr() as *mut u8, std::mem::size_of::<T>());
    val.assume_init()
}

pub fn encode_string_ref_data(sr: StringRef) -> Vec<u8> {
    unsafe { struct_to_bytes(&sr) }.to_vec()
}

pub fn decode_string_ref_data(bytes: &[u8]) -> StringRef {
    unsafe { bytes_to_struct(bytes) }
}
