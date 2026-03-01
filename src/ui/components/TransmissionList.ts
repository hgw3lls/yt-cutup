import type { TransmissionIndexEntry } from "../../lib/schema";

type TransmissionListOptions = {
  transmissions: TransmissionIndexEntry[];
  selectedId: string | null;
  onSelect: (transmissionId: string) => void;
};

export function renderTransmissionList(container: HTMLElement, options: TransmissionListOptions): void {
  container.innerHTML = "";

  const heading = document.createElement("h3");
  heading.textContent = "Transmissions";
  container.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "transmission-list";

  for (const transmission of options.transmissions) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "transmission-list__item";
    if (transmission.transmission_id === options.selectedId) {
      button.classList.add("is-active");
    }

    button.textContent = `${transmission.title} (${transmission.transmission_id})`;
    button.addEventListener("click", () => options.onSelect(transmission.transmission_id));

    item.appendChild(button);
    list.appendChild(item);
  }

  container.appendChild(list);
}
