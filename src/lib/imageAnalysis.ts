/**
 * Client-side image analysis pipeline for Da RoastBox.
 * Extracts visual characteristics from uploaded photos to build
 * a roast_profile with visual_hooks, style_hooks, and callbacks.
 * No invented facts — only observable features.
 */

export interface RoastProfile {
  visual_hooks: string[];
  style_hooks: string[];
  callbacks: string[];
  best_angles: string[];
  raw_features: {
    brightness: number;
    contrast: number;
    warmth: number;
    saturation: number;
    dominant_colors: string[];
    face_region?: { x: number; y: number; w: number; h: number };
    estimated_expression: string;
    hair_descriptor: string;
    outfit_descriptor: string;
    overall_energy: string;
  };
  hint_string: string;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s, l];
}

function colorName(h: number, s: number, l: number): string {
  if (l < 0.15) return 'very dark';
  if (l > 0.85) return 'very light';
  if (s < 0.12) return l < 0.4 ? 'dark grey' : l > 0.6 ? 'light grey' : 'grey';
  if (h < 15 || h >= 345) return s > 0.5 ? 'bold red' : 'muted red';
  if (h < 45) return 'warm orange';
  if (h < 65) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 285) return 'purple';
  if (h < 345) return 'magenta';
  return 'red';
}

function isSkinTone(r: number, g: number, b: number): boolean {
  const [, s, l] = rgbToHsl(r, g, b);
  // Skin tone heuristic: R > G > B, moderate saturation, moderate lightness
  return r > 95 && r > g && g > b &&
    (r - g) > 15 && (r - b) > 15 &&
    s > 0.1 && s < 0.6 && l > 0.2 && l < 0.85;
}

export async function analyzeImage(file: File): Promise<RoastProfile> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  const maxDim = 200; // Downscale for fast analysis
  const scale = Math.min(maxDim / img.width, maxDim / img.height);
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let totalR = 0, totalG = 0, totalB = 0;
  let minL = 1, maxL = 0;
  const colorBuckets: Record<string, number> = {};
  let skinPixels = 0;
  let skinMinX = canvas.width, skinMaxX = 0;
  let skinMinY = canvas.height, skinMaxY = 0;
  const totalPixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    totalR += r; totalG += g; totalB += b;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
    const cn = colorName(h, s, l);
    colorBuckets[cn] = (colorBuckets[cn] || 0) + 1;
    if (isSkinTone(r, g, b)) {
      skinPixels++;
      const px = (i / 4) % canvas.width;
      const py = Math.floor((i / 4) / canvas.width);
      if (px < skinMinX) skinMinX = px;
      if (px > skinMaxX) skinMaxX = px;
      if (py < skinMinY) skinMinY = py;
      if (py > skinMaxY) skinMaxY = py;
    }
  }

  const avgR = totalR / totalPixels;
  const avgG = totalG / totalPixels;
  const avgB = totalB / totalPixels;
  const brightness = (avgR + avgG + avgB) / (3 * 255);
  const contrast = maxL - minL;
  const warmth = (avgR - avgB) / 255; // positive = warm, negative = cool
  const [, avgSat] = rgbToHsl(avgR, avgG, avgB);

  const sortedColors = Object.entries(colorBuckets).sort((a, b) => b[1] - a[1]);
  const dominantColors = sortedColors.slice(0, 4).map(([c]) => c);

  const skinRatio = skinPixels / totalPixels;
  let faceRegion: RoastProfile['raw_features']['face_region'];
  if (skinRatio > 0.03) {
    faceRegion = {
      x: skinMinX, y: skinMinY,
      w: skinMaxX - skinMinX, h: skinMaxY - skinMinY,
    };
  }

  // Build descriptors
  const brightnessDesc = brightness < 0.3 ? 'dark and moody' : brightness > 0.7 ? 'bright and washed out' : 'well-lit';
  const warmthDesc = warmth > 0.1 ? 'warm-toned' : warmth < -0.1 ? 'cool-toned' : 'neutral-toned';
  const contrastDesc = contrast > 0.7 ? 'high-contrast' : contrast < 0.3 ? 'flat' : 'balanced';
  const energyDesc = avgSat > 0.4 ? 'colorful and loud' : avgSat < 0.15 ? 'muted and subdued' : 'moderately styled';

  // Expression estimation from face region brightness variation
  let expression = 'neutral';
  if (faceRegion) {
    const faceBrightness = brightness;
    if (faceBrightness > 0.6 && avgSat > 0.25) expression = 'bright and possibly smiling';
    else if (faceBrightness < 0.35) expression = 'moody or serious';
    else expression = 'composed';
  }

  // Hair descriptor based on top region darkness
  let hairDescriptor = 'standard hairstyle';
  if (faceRegion) {
    const topSlice = ctx.getImageData(
      Math.max(0, faceRegion.x), 0,
      Math.min(canvas.width - faceRegion.x, faceRegion.w),
      Math.max(2, faceRegion.y)
    );
    let topBrightness = 0;
    for (let i = 0; i < topSlice.data.length; i += 4) {
      topBrightness += (topSlice.data[i] + topSlice.data[i + 1] + topSlice.data[i + 2]) / 3;
    }
    topBrightness /= (topSlice.data.length / 4 * 255);
    if (topBrightness < 0.25) hairDescriptor = 'dark hair';
    else if (topBrightness > 0.7) hairDescriptor = 'light or bleached hair';
    else if (topBrightness > 0.5) hairDescriptor = 'medium-toned hair';
    else hairDescriptor = 'brown hair';
  }

  // Outfit descriptor from bottom region
  let outfitDescriptor = 'casual outfit';
  if (faceRegion) {
    const bottomY = Math.min(canvas.height - 1, faceRegion.y + faceRegion.h + 10);
    const bottomSlice = ctx.getImageData(0, bottomY, canvas.width, Math.min(40, canvas.height - bottomY));
    let bR = 0, bG = 0, bB = 0;
    for (let i = 0; i < bottomSlice.data.length; i += 4) {
      bR += bottomSlice.data[i]; bG += bottomSlice.data[i + 1]; bB += bottomSlice.data[i + 2];
    }
    const count = bottomSlice.data.length / 4;
    bR /= count; bG /= count; bB /= count;
    const [bh, bs] = rgbToHsl(bR, bG, bB);
    if (bs < 0.15) outfitDescriptor = bR < 80 ? 'dark, monochrome outfit' : 'light, plain outfit';
    else outfitDescriptor = `${colorName(bh, bs, (bR + bG + bB) / (3 * 255))} outfit`;
  }

  const visual_hooks: string[] = [
    `${brightnessDesc} ${warmthDesc} presentation`,
    `${contrastDesc} photo with ${energyDesc} overall energy`,
    `dominant colors: ${dominantColors.join(', ')}`,
    expression !== 'neutral' ? `expression reads as ${expression}` : '',
    hairDescriptor !== 'standard hairstyle' ? hairDescriptor : '',
    outfitDescriptor !== 'casual outfit' ? `wearing a ${outfitDescriptor}` : '',
  ].filter(Boolean);

  const style_hooks: string[] = [
    warmth > 0.1 ? 'warm color palette suggests trying too hard to look approachable' : '',
    warmth < -0.1 ? 'cool tones suggest calculated, distant personality' : '',
    avgSat > 0.4 ? 'loud, attention-seeking color choices' : '',
    avgSat < 0.15 ? 'muted tones suggest someone who blends into the background' : '',
    brightness > 0.7 ? 'overexposed — hiding behind brightness' : '',
    brightness < 0.3 ? 'dark and moody — trying to seem mysterious' : '',
    contrast > 0.7 ? 'high-contrast drama queen energy' : '',
  ].filter(Boolean);

  const callbacks: string[] = visual_hooks.slice(0, 3);
  const best_angles: string[] = [
    expression,
    hairDescriptor,
    outfitDescriptor,
    energyDesc,
  ];

  const hintString = [
    `Photo analysis: ${brightnessDesc}, ${warmthDesc}, ${contrastDesc}.`,
    `Subject appears ${expression} with ${hairDescriptor} and ${outfitDescriptor}.`,
    `Overall energy: ${energyDesc}. Dominant colors: ${dominantColors.join(', ')}.`,
    style_hooks.length > 0 ? `Style reads: ${style_hooks[0]}.` : '',
  ].filter(Boolean).join(' ');

  return {
    visual_hooks,
    style_hooks,
    callbacks,
    best_angles,
    raw_features: {
      brightness, contrast, warmth, saturation: avgSat,
      dominant_colors: dominantColors,
      face_region: faceRegion,
      estimated_expression: expression,
      hair_descriptor: hairDescriptor,
      outfit_descriptor: outfitDescriptor,
      overall_energy: energyDesc,
    },
    hint_string: hintString,
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
