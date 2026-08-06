import fs from "node:fs";
import path from "node:path";
import process from "node:process";

if (!process.env.LOCALAPPDATA) {
  console.error("Không tìm thấy LOCALAPPDATA.");
  process.exit(1);
}

const profileName = process.env.CHROME_PROFILE?.trim() || "Profile 1";

const sourceRoot = path.join(
  process.env.LOCALAPPDATA,
  "Google",
  "Chrome",
  "User Data"
);

const destinationRoot = path.join(
  process.env.LOCALAPPDATA,
  "TikTokLiveCollectorChrome"
);

const sourceProfile = path.join(sourceRoot, profileName);
const destinationProfile = path.join(destinationRoot, profileName);

const excludedNames = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "Media Cache",
  "VideoDecodeStats",
  "Crashpad",
  "BrowserMetrics",
  "Safe Browsing",
  "component_crx_cache",
  "extensions_crx_cache",
  "OptimizationGuidePredictionModels",
  "segmentation_platform",
]);

function shouldCopy(source) {
  const name = path.basename(source);
  return !excludedNames.has(name);
}

function removeIfExists(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 500,
    });
  }
}

if (!fs.existsSync(sourceProfile)) {
  console.error(`Không tìm thấy profile nguồn: ${sourceProfile}`);
  process.exit(1);
}

const localStateSource = path.join(sourceRoot, "Local State");
if (!fs.existsSync(localStateSource)) {
  console.error(`Không tìm thấy: ${localStateSource}`);
  process.exit(1);
}

console.log("Nguồn:", sourceProfile);
console.log("Đích:", destinationProfile);
console.log("Đang tạo bản sao Profile 1...");

fs.mkdirSync(destinationRoot, { recursive: true });

removeIfExists(destinationProfile);

fs.copyFileSync(
  localStateSource,
  path.join(destinationRoot, "Local State")
);

const firstRunPath = path.join(destinationRoot, "First Run");
if (!fs.existsSync(firstRunPath)) {
  fs.writeFileSync(firstRunPath, "", "utf8");
}

fs.cpSync(sourceProfile, destinationProfile, {
  recursive: true,
  force: true,
  errorOnExist: false,
  filter: shouldCopy,
});

console.log("");
console.log("ĐỒNG BỘ PROFILE THÀNH CÔNG");
console.log("Hồ sơ collector:", destinationRoot);
console.log("");
console.log("Bây giờ chạy:");
console.log("  start_live.bat username");
