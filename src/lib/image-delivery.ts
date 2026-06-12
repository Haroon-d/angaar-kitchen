type CloudinaryOptions = {
  width: number;
  height?: number;
  crop?: "fill" | "fit" | "limit";
  quality?: string;
};

export function optimizeCloudinaryImageUrl(
  url: string | null | undefined,
  options: CloudinaryOptions,
) {
  if (!url) return url ?? null;
  if (!isCloudinaryImageUrl(url)) return url;

  const transformation = [
    "f_auto",
    `q_${options.quality ?? "auto"}`,
    `w_${options.width}`,
    options.height ? `h_${options.height}` : null,
    `c_${options.crop ?? "fill"}`,
    "dpr_auto",
  ]
    .filter(Boolean)
    .join(",");

  return url.replace("/upload/", `/upload/${transformation}/`);
}

export function cloudinaryImageSrcSet(url: string | null | undefined, widths: number[]) {
  if (!url || !isCloudinaryImageUrl(url)) return undefined;
  return widths
    .map((width) => `${optimizeCloudinaryImageUrl(url, { width })} ${width}w`)
    .join(", ");
}

export function isCloudinaryImageUrl(url: string) {
  return /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//i.test(url);
}
