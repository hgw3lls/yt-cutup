export type QueryRow = {
  transmissionId: string;
  categoryId: string;
  query: string;
  queued: boolean;
};

type QueryTableOptions = {
  rows: QueryRow[];
  onToggleQueue: (row: QueryRow, queued: boolean) => void;
};

export function renderQueryTable(container: HTMLElement, options: QueryTableOptions): void {
  container.innerHTML = "";

  const table = document.createElement("table");
  table.className = "query-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>Query</th>
      <th>Actions</th>
      <th>Queue Query</th>
      <th>Tags</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const [index, row] of options.rows.entries()) {
    const tr = document.createElement("tr");

    const queryCell = document.createElement("td");
    queryCell.textContent = row.query;

    const actionCell = document.createElement("td");
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.textContent = "Open Search";
    openButton.setAttribute("aria-label", `Open YouTube search for ${row.query}`);
    openButton.addEventListener("click", () => {
      const encodedQuery = encodeURIComponent(row.query);
      window.open(`https://www.youtube.com/results?search_query=${encodedQuery}`, "_blank", "noopener,noreferrer");
    });
    actionCell.appendChild(openButton);

    const queueCell = document.createElement("td");
    const checkboxId = `queue-query-${index}`;
    const checkbox = document.createElement("input");
    checkbox.id = checkboxId;
    checkbox.type = "checkbox";
    checkbox.checked = row.queued;
    checkbox.addEventListener("change", () => options.onToggleQueue(row, checkbox.checked));

    const label = document.createElement("label");
    label.htmlFor = checkboxId;
    label.textContent = " Queue";

    queueCell.appendChild(checkbox);
    queueCell.appendChild(label);

    const tagsCell = document.createElement("td");
    tagsCell.appendChild(createTagChip(row.categoryId));
    tagsCell.appendChild(createTagChip(row.transmissionId));

    tr.appendChild(queryCell);
    tr.appendChild(actionCell);
    tr.appendChild(queueCell);
    tr.appendChild(tagsCell);

    tbody.appendChild(tr);
  }

  if (options.rows.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 4;
    emptyCell.textContent = "No queries match the current filters.";
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

function createTagChip(value: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "tag-chip";
  chip.textContent = value;
  return chip;
}
