const {
  LANGUAGES,
  displayLanguage,
  extractPrUrls,
  isLanguageApplicable,
  lower,
  parsePrUrl,
  plainText,
} = require("./v2-common");

const POLICY_VERSION = 1;

function assessPreflight(item, specs) {
  const fields = item.fields || {};
  const reasons = [];
  const releasePlanId = plainText(fields["Custom.ReleasePlanID"], 100);
  const specPrs = currentSpecPrs(specs);
  const languages = LANGUAGES.filter((language) =>
    isLanguageApplicable(fields, language),
  )
    .map((language) => languageSnapshot(fields, language))
    .filter((language) => language.generationStage !== "not-applicable");

  if (!releasePlanId) reasons.push("missing-release-plan-id");
  if (!specPrs.length) reasons.push("missing-spec-pr");

  return {
    compliant: reasons.length === 0,
    reasons,
    releasePlanId: releasePlanId || null,
    specPrs,
    languages,
  };
}

function currentSpecPrs(specs) {
  const values = new Map();
  for (const spec of specs) {
    const active = parsePrUrl(spec.fields?.["Custom.ActiveSpecPullRequestUrl"]);
    if (active) values.set(active.id, active);
    for (const url of extractPrUrls(spec.fields?.["Custom.RESTAPIReviews"])) {
      const pr = parsePrUrl(url);
      if (pr) values.set(pr.id, pr);
    }
  }
  return [...values.values()];
}

function languageSnapshot(fields, language) {
  const id = displayLanguage(language);
  const generationStatus = plainText(
    fields[`Custom.GenerationStatusFor${language}`],
    80,
  );
  const sdkPrObservedStatus = plainText(
    fields[`Custom.SDKPullRequestStatusFor${language}`],
    80,
  );
  const releaseStatus = plainText(
    fields[`Custom.ReleaseStatusFor${language}`],
    80,
  );
  const generationPipelineUrl =
    String(fields[`Custom.SDKGenerationPipelineFor${language}`] || "") || null;
  const releasePipelineUrl =
    String(fields[`Custom.ReleasePipelineFor${language}`] || "") || null;
  const releasedVersion =
    plainText(fields[`Custom.ReleasedVersionFor${language}`], 100) || null;
  const sdkPr = parsePrUrl(fields[`Custom.SDKPullRequestFor${language}`]);
  const releaseStage = classifyRelease(
    releaseStatus,
    releasePipelineUrl,
    releasedVersion,
  );
  const generationStage = classifyGeneration({
    status: generationStatus,
    sdkPrStatus: sdkPrObservedStatus,
    generationPipelineUrl,
    sdkPr,
    releaseStage,
  });
  return {
    id,
    key: language,
    package: plainText(fields[`Custom.${language}PackageName`], 160),
    generationStatus,
    generationStage,
    generationPipelineUrl,
    sdkPr,
    sdkPrObservedStatus,
    releaseStatus,
    releasePipelineUrl,
    releasedVersion,
  };
}

function classifyGeneration({
  status,
  sdkPrStatus,
  generationPipelineUrl,
  sdkPr,
  releaseStage,
}) {
  const value = lower(status);
  const prValue = lower(sdkPrStatus);
  if (value === "not applicable") return "not-applicable";
  if (value.includes("fail") || prValue.includes("failed to generate"))
    return "failed";
  if (
    value === "completed" ||
    sdkPr ||
    (prValue && prValue !== "not available") ||
    releaseStage !== "not-started"
  )
    return "completed";
  if (value === "in progress" || generationPipelineUrl) return "started";
  return "pending";
}

function classifyRelease(status, pipelineUrl, version) {
  const value = lower(status);
  if (value.includes("released")) return "released";
  if (value.includes("fail")) return "failed";
  if (
    pipelineUrl ||
    version ||
    (value && !["not applicable", "not started", "pending"].includes(value))
  )
    return "started";
  return "not-started";
}

module.exports = {
  POLICY_VERSION,
  assessPreflight,
};
