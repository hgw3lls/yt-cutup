export type ErrorBoundaryOptions = {
  title?: string;
  retry?: () => void;
};

export function renderErrorBoundary(container: HTMLElement, error: unknown, options: ErrorBoundaryOptions = {}): void {
  container.innerHTML = "";

  const wrapper = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = options.title ?? "Something went wrong";

  const message = document.createElement("p");
  message.textContent = error instanceof Error ? error.message : "An unknown error occurred.";

  wrapper.appendChild(heading);
  wrapper.appendChild(message);

  if (options.retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", options.retry);
    wrapper.appendChild(button);
  }

  container.appendChild(wrapper);
}
