import type { ValidationReport } from "../lib/loaders";

export function renderValidationReport(container: HTMLElement, report: ValidationReport): void {
  container.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent = report.ok ? "Validation: PASS" : "Validation: FAIL";
  title.style.color = report.ok ? "#188038" : "#b3261e";
  container.appendChild(title);

  const transmissionHeading = document.createElement("h3");
  transmissionHeading.textContent = "Transmissions";
  container.appendChild(transmissionHeading);

  const list = document.createElement("ul");

  for (const module of report.modules) {
    const item = document.createElement("li");
    const status = module.ok ? "✅ PASS" : "❌ FAIL";
    item.textContent = `${status} — ${module.transmissionId} (${module.file})`;

    if (!module.ok) {
      const errorList = document.createElement("ul");
      for (const error of module.errors) {
        const errorItem = document.createElement("li");
        errorItem.textContent = error;
        errorList.appendChild(errorItem);
      }
      item.appendChild(errorList);
    }

    list.appendChild(item);
  }

  container.appendChild(list);

  const clipsHeading = document.createElement("h3");
  clipsHeading.textContent = "Clips Manifest";
  container.appendChild(clipsHeading);

  const clipsItem = document.createElement("div");
  clipsItem.textContent = `${report.clipsManifest.ok ? "✅ PASS" : "❌ FAIL"} — ${report.clipsManifest.file}`;
  container.appendChild(clipsItem);

  if (!report.clipsManifest.ok) {
    const clipsErrors = document.createElement("ul");
    for (const error of report.clipsManifest.errors) {
      const errorItem = document.createElement("li");
      errorItem.textContent = error;
      clipsErrors.appendChild(errorItem);
    }
    container.appendChild(clipsErrors);
  }
}
