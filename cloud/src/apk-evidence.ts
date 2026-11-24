import { createHash } from "node:crypto";

export interface ApkEvidenceResult {
  sha256: string;
  sizeInBytes: number;
  packageName: string | null;
  versionName: string | null;
  supportedArchitectures: string[];
  signatureVerified: boolean;
  checksumMatches: boolean;
  verified: boolean;
}

/** Parses the evidence artifact produced by the GitHub-hosted signed-release workflow. */
export function verifyApkEvidence(
  apkBytes: Uint8Array,
  evidenceText: string,
  expectedPackage = "com.sikorokoro44.cloudopencode",
): ApkEvidenceResult {
  const sha256 = createHash("sha256").update(apkBytes).digest("hex");
  const checksumMatch = evidenceText.match(/\b([a-f0-9]{64})\s+\S+\.apk\b/i);
  const checksumMatches = checksumMatch ? checksumMatch[1].toLowerCase() === sha256 : false;
  const hasFailureMarker = /DOES NOT VERIFY|Verification failed|invalid signature/i.test(evidenceText);
  const hasSuccessMarker = /\bVerifies\b/i.test(evidenceText) || /Verified using v[1-4]\s+scheme/i.test(evidenceText);
  const signatureVerified = hasSuccessMarker && !hasFailureMarker;
  const packageMatch = evidenceText.match(/package:\s+name='([^']+)'/);
  const versionMatch = evidenceText.match(/versionName='([^']+)'/);
  const nativeMatch = evidenceText.match(/native-code:\s+((?:'[^']+'\s*)+)/);
  const supportedArchitectures = nativeMatch
    ? [...nativeMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
    : [];
  const packageName = packageMatch ? packageMatch[1] : null;
  const packageMatches = !expectedPackage || packageName === expectedPackage;
  return {
    sha256,
    sizeInBytes: apkBytes.length,
    packageName,
    versionName: versionMatch ? versionMatch[1] : null,
    supportedArchitectures,
    signatureVerified,
    checksumMatches,
    verified: signatureVerified && checksumMatches && packageMatches,
  };
}
