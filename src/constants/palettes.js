// ─── Color palettes + backgrounds + bucketing constants ───
//
// Palettes are arrays of hex strings; the renderer picks indexes
// modulo array length when assigning a color per genre bucket.
// OTHER is the fallback color for genres that fall outside the
// MAX_GENRES most-frequent buckets.

export const PALETTES = {
  // Dieter Rams — Braun-inspired functional minimalism
  rams:       ['#333333','#555555','#888888','#AAAAAA','#CCCCCC','#1A1A1A','#444444','#666666','#999999','#BBBBBB','#DDDDDD','#2A2A2A','#777777','#E0E0E0','#F0F0F0'],
  // Evangelion — NERV purple/green/orange warning palette
  evangelion: ['#6B2D8B','#4A0E6B','#FF6600','#00CC66','#9B30FF','#8844AA','#FF4400','#33BB55','#5D0066','#CC5500','#22AA44','#7744BB','#E87700','#44DD66','#AA55CC'],
  // Ultramarine — deep saturated blues
  ultramarine:['#2B3A8E','#3D50B5','#1A2670','#5468CC','#4358C4','#6678D4','#2940A0','#7888DC','#1E3080','#8A98E4','#3448B0','#9CA8EC','#0F1860','#AEB8F0','#C0C8F4'],
  // Rose — blush and coral tones
  rose:       ['#E8919A','#D4707A','#F2ABB3','#C05060','#F8C5CC','#B84050','#ECBEC4','#A03040','#F5D5DA','#CC6070','#E0A0A8','#982838','#D88890','#882028','#FCD8DC'],
  // Teal — seafoam and aqua
  teal:       ['#3AAFA9','#2B8A84','#5CC4BE','#1D706C','#7CD8D2','#4ABFB9','#167060','#8EE4DE','#358F88','#A0EEE8','#278078','#52C8C2','#0F5E58','#B2F4EE','#C4F8F4'],
  // Desert — warm bronze and amber
  desert:     ['#C4843B','#D4975A','#B87333','#E8AD6A','#A0652A','#DEB887','#C68E4E','#8B6914','#D2A56C','#BA8C3C','#E6C28E','#9B7432','#CFAA68','#7D5A28','#F0D4A4'],
  // Lavender — soft purple-lilac
  lavender:   ['#9B8EC4','#7B6FA0','#B5A8D8','#6A5C90','#C8BEE8','#8878B4','#5A4C80','#D5CCF0','#7466A8','#E2DAF4','#A496CC','#4A3C70','#BBAEE0','#6558A0','#EEE8F8'],
  // Spectrum — balanced restrained rainbow
  spectrum:   ['#E06070','#D89050','#E8C050','#70B868','#50A8B8','#5878C8','#7868B8','#A060A8','#C86880','#D8A060','#B8D058','#48B098','#6088D0','#8878C0','#B868A0'],
  // Mono — clean grayscale
  mono:       ['#111','#222','#333','#444','#555','#666','#777','#888','#999','#aaa','#bbb','#ccc','#ddd','#e5e5e5','#f0f0f0'],
};

export const BACKGROUNDS = {
  white: '#ffffff',
  snow: '#F5F5F7',
  graphite: '#2C2C2E',
  black: '#0A0A0A',
  midnight: '#0D1B2A',
  ink: '#121218',
  geofront: '#0A0F14',
};

// Fallback color used for any genre bucket beyond the MAX_GENRES cutoff.
export const OTHER = '#bbbbbb';

// Cap on how many distinct genre buckets get their own palette color.
// Anything beyond this collapses into the "Other" bucket.
export const MAX_GENRES = 15;
