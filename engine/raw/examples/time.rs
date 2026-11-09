// Times the RAW stage on a file: cargo run --release --example time -- <file.RAF>
fn main() {
  let p = std::env::args().nth(1).expect("a raw file");
  let bytes = std::fs::read(&p).unwrap();
  let t = std::time::Instant::now();
  let d = th_raw::decode_native(&bytes).unwrap();
  println!("{:?} {}x{} {}", t.elapsed(), d.width(), d.height(), d.meta());
  if let Some(out) = std::env::args().nth(2) { let v: Vec<u8> = d.proxy().iter().flat_map(|x| x.to_le_bytes()).collect(); std::fs::write(out, v).unwrap(); }
}
// (with a second argument, also writes the proxy as raw RGBA u16 little-endian for checking)
#[allow(dead_code)]
fn _unused() {}
