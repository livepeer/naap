/** Shorten "NVIDIA GeForce RTX 5090" -> "RTX 5090" for compact UI labels. */
export function shortGPUName(name: string): string {
  return name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '');
}
