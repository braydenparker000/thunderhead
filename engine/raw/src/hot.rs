//! Hot sensels: a site that reads far above the truth (a leaky photodiode; long exposures and warm sensors
//! show more). Left in, the demosaic spreads each into a coloured cross. A site is hot when it reads at least
//! `RATIO` times every site of its own colour within two of it, by a clear margin, and the sites touching it
//! are not lifted with it: a lens spreads a real point of light (a star, a glint) onto its neighbours, and a
//! hot sensel stands alone. It is given the mean of those same-colour sites. Deliberately cautious: on nine
//! 40 MP X-Trans photos it changes nothing, and of sensels planted 3 to 50 % of the range above the photo it
//! mends 60 to 80 % (those it leaves sit on bright ground, where they barely show).
use rayon::prelude::*;

/// How many times its brightest same-colour neighbour a hot sensel reads at least.
const RATIO: f32 = 3.0;
/// And by how much more, as a share of the sensor's range (well clear of noise at any ISO).
const OVER: f32 = 0.015;
/// The sites touching it may read this many times those one further out, and no more.
const LIFT: f32 = 1.3;

/// Mends the hot sensels in `data` (`w` a row) and says how many there were. `colour` is the pattern, `cw` by
/// `ch`, from the data's first sensel (0 red, 1 green, 2 blue).
pub fn mend(data: &mut [u16], w: usize, colour: &[usize], cw: usize, ch: usize, black: f32, white: f32) -> usize {
  let h = if w == 0 { 0 } else { data.len() / w };
  if w < 5 || h < 5 || cw == 0 || colour.len() < cw * ch { return 0; }
  let over = OVER * (white - black).max(1.0);
  let at = |x: isize, y: isize| colour[y.rem_euclid(ch as isize) as usize * cw + x.rem_euclid(cw as isize) as usize];
  // for each place in the pattern, the way to every site of its colour within two
  let same: Vec<Vec<isize>> = (0..cw * ch).map(|p| {
    let (px, py) = ((p % cw) as isize, (p / cw) as isize);
    (-2..=2isize).flat_map(|j| (-2..=2isize).map(move |i| (i, j))).filter(|&(i, j)| (i, j) != (0, 0) && at(px + i, py + j) == colour[p]).map(|(i, j)| j * w as isize + i).collect()
  }).collect();
  let d = &*data;
  // nearly every site is let go here, by whole numbers and the first neighbour of its colour (a little loosely:
  // the full test below decides)
  let (b, ov) = (black.round() as i32, over as i32 - 4);
  let first: Vec<isize> = same.iter().map(|l| l.first().copied().unwrap_or(0)).collect();
  let found: Vec<(usize, u16)> = (2..h - 2).into_par_iter().flat_map_iter(|y| {
    let mut out = Vec::new();
    let (line, mut px) = ((y % ch) * cw, 2 % cw);
    for x in 2..w - 2 {
      let (p, i) = (line + px, y * w + x);
      px += 1;
      if px == cw { px = 0; }
      let q = d[i] as i32 - b;
      if q < ov || q < RATIO as i32 * (d[(i as isize + first[p]) as usize] as i32 - b) + ov { continue; }
      let (v, near) = (d[i] as f32 - black, &same[p]);
      let mut sum = 0f32;
      if v < over || near.is_empty() || near.iter().any(|&o| { let n = d[(i as isize + o) as usize] as f32 - black; sum += n; v < RATIO * n.max(0.0) + over }) { continue; }
      // each colour's mean in the ring of 8 round it against the ring of 16 beyond
      let (mut s, mut n) = ([[0f32; 3]; 2], [[0u32; 3]; 2]);
      for j in -2..=2isize {
        for k in -2..=2isize {
          let ring = j.abs().max(k.abs());
          if ring == 0 { continue; }
          let c = at(x as isize + k, y as isize + j).min(2);
          s[ring as usize - 1][c] += d[(i as isize + j * w as isize + k) as usize] as f32 - black;
          n[ring as usize - 1][c] += 1;
        }
      }
      let (mut close, mut far) = (0f32, 0f32);
      for c in 0..3 { if n[0][c] > 0 && n[1][c] > 0 { close += s[0][c] / n[0][c] as f32; far += s[1][c] / n[1][c] as f32; } }
      if close <= LIFT * far.max(1.0) || close - far < 0.3 * over { out.push((i, (sum / near.len() as f32 + black).round().clamp(0.0, 65535.0) as u16)); }
    }
    out
  }).collect();
  for &(i, v) in &found { data[i] = v; }
  found.len()
}

#[cfg(test)]
mod tests {
  use super::mend;
  /// The X-Trans pattern (0 red, 1 green, 2 blue).
  const XTRANS: [usize; 36] = [1, 0, 1, 1, 2, 1, 2, 1, 2, 0, 1, 0, 1, 0, 1, 1, 2, 1, 1, 2, 1, 1, 0, 1, 0, 1, 0, 2, 1, 2, 1, 2, 1, 1, 0, 1];
  const W: usize = 60;
  /// A flat grey field with a little texture, black level 1000 of a 16383 range.
  fn field() -> Vec<u16> { (0..W * W).map(|i| 3000 + ((i * 7919) % 97) as u16).collect() }

  #[test]
  fn a_hot_sensel_is_mended_and_nothing_else_is_touched() {
    let (mut d, clean) = (field(), field());
    for &i in &[20 * W + 20, 31 * W + 33, 40 * W + 11] { d[i] = 12000; }
    assert_eq!(mend(&mut d, W, &XTRANS, 6, 6, 1000.0, 16383.0), 3);
    for (i, (a, b)) in d.iter().zip(&clean).enumerate() { assert!((*a as i32 - *b as i32).abs() < 100, "site {i}: {a} against {b}"); }
  }

  #[test]
  fn a_point_of_light_the_lens_spread_is_left_alone() {
    let mut d = field();
    let c = 30 * W + 30;
    d[c] = 15000;
    for o in [-1isize, 1, -(W as isize), W as isize] { d[(c as isize + o) as usize] = 8000; }   // what a lens does to a star
    let before = d.clone();
    assert_eq!(mend(&mut d, W, &XTRANS, 6, 6, 1000.0, 16383.0), 0);
    assert_eq!(d, before);
  }

  #[test]
  fn a_plain_photo_and_a_tiny_one_are_left_alone() {
    let mut d = field();
    assert_eq!(mend(&mut d, W, &XTRANS, 6, 6, 1000.0, 16383.0), 0);
    assert_eq!(mend(&mut [0u16; 12], 4, &XTRANS, 6, 6, 0.0, 16383.0), 0);
  }
}
