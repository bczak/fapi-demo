import type { Db } from "./client";
import { products } from "./schema";

// [name, description, net price in whole CZK]
const CATALOGUE: [string, string, number][] = [
  ["Notebook Pro 14", '14" laptop, 16 GB RAM, 512 GB SSD', 24_990],
  ["Notebook Air 13", "Fanless, 18 h battery, 8 GB RAM", 18_490],
  ["Gaming Laptop 16", "RTX graphics, 165 Hz display", 36_990],
  ["Tablet 11", '11" display, stylus support, 128 GB', 9_990],
  ["Smartphone X", '6.1" OLED, 256 GB, dual camera', 15_990],
  ["Smartwatch Active", "GPS, heart-rate sensor, 5-day battery", 4_990],
  ["Mechanical Keyboard", "Hot-swappable switches, aluminium case", 2_990],
  ["Compact Keyboard 65%", "Bluetooth, three-device pairing", 1_890],
  ["Wireless Mouse", "Ergonomic, 70-day battery life", 899],
  ["Vertical Mouse", "Ergonomic grip, 4000 DPI", 1_190],
  ["Gaming Mouse", "26 000 DPI sensor, 58 g", 1_790],
  ["USB-C Hub 7-in-1", "HDMI, 2x USB-A, SD, Ethernet, 100 W PD", 1_299],
  ["Docking Station", "Dual 4K output, 12 ports, 96 W charging", 4_290],
  ['Monitor 27" 4K', "IPS panel, USB-C with 90 W charging", 10_990],
  ['Ultrawide Monitor 34"', "3440x1440, 144 Hz, curved", 12_490],
  ["Monitor Stand", "Solid oak with a storage drawer", 1_190],
  ["Monitor Arm", "Gas spring, VESA, up to 9 kg", 1_490],
  ["Desk Lamp", "Dimmable LED, adjustable colour temperature", 790],
  ["Standing Desk", "Electric, 140x70 cm, memory presets", 8_990],
  ["Ergonomic Chair", "Mesh back, adjustable lumbar support", 6_490],
  ["Footrest", "Adjustable angle, non-slip surface", 690],
  ["Desk Mat XL", "Felt, 90x40 cm, anti-slip base", 590],
  ["Laptop Stand", "Foldable aluminium, six heights", 790],
  ['Laptop Sleeve 14"', "Water-repellent, felt lining", 590],
  ["Backpack 22 L", "Padded laptop compartment, USB port", 1_690],
  ["Webcam 1080p", "Autofocus, dual microphones, privacy shutter", 1_490],
  ["Webcam 4K", "HDR, auto framing, wide angle", 3_290],
  ["Studio Microphone", "USB cardioid condenser, mute button", 2_490],
  ["Headset Wireless", "Noise cancelling, 40 h battery", 3_990],
  ["Over-ear Headphones", "Studio sound, detachable cable", 2_790],
  ["Earbuds Pro", "Active noise cancelling, wireless charging", 3_490],
  ["Bluetooth Speaker", "Waterproof, 20 h playtime", 1_990],
  ["Soundbar", "2.1 channels, HDMI ARC, wireless subwoofer", 5_990],
  ["Portable SSD 1 TB", "USB 3.2, up to 1050 MB/s", 2_790],
  ["Portable SSD 2 TB", "USB 3.2, shock resistant", 4_490],
  ["USB Flash Drive 128 GB", "USB-A and USB-C connectors", 349],
  ["Memory Card 256 GB", "UHS-I, 160 MB/s read", 599],
  ["Power Bank 20 000 mAh", "65 W USB-C, charges a laptop", 1_590],
  ["GaN Charger 100 W", "Three ports, foldable plug", 1_190],
  ["USB-C Cable 2 m", "240 W, braided, e-marked", 299],
  ["Wireless Charging Pad", "15 W, works through slim cases", 490],
  ["Wi-Fi 7 Router", "Tri-band, 2.5 Gbit WAN, mesh ready", 4_990],
  ["Mesh Wi-Fi 3-pack", "Whole-home coverage up to 500 m²", 7_990],
  ["Network Switch 8-port", "Gigabit, metal case, fanless", 890],
  ["Smart Plug 4-pack", "Energy monitoring, voice control", 790],
  ["Smart LED Bulb 2-pack", "16 million colours, E27", 590],
  ["Security Camera", "2K, night vision, local storage", 1_490],
  ['E-reader 6.8"', "Front light, waterproof, 16 GB", 3_990],
  ["Drawing Tablet", '10x6" active area, tilt support', 2_390],
  ["Action Camera", "5K video, waterproof to 10 m", 6_490],
];

const imageFor = (name: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}/800/600`;

const SEED_PRODUCTS = CATALOGUE.map(([name, description, czk]) => ({
  name,
  description,
  priceMinor: czk * 100,
  imageUrl: imageFor(name),
}));

/** Inserts demo products when the catalogue is empty. */
export function seedProducts(db: Db) {
  const existing = db.select({ id: products.id }).from(products).limit(1).get();
  if (!existing) db.insert(products).values(SEED_PRODUCTS).run();
}
