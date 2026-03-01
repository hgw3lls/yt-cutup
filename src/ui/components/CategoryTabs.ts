const CATEGORY_ORDER = [
  "news_political",
  "film_tv",
  "advertisements",
  "radio_broadcast",
  "system_ui",
  "corporate_institutional",
  "cultural_music",
  "propaganda_warning_layer",
] as const;

export type CategoryId = (typeof CATEGORY_ORDER)[number];

type CategoryTabsOptions = {
  categoriesPresent: Set<string>;
  selectedCategory: string;
  onSelect: (categoryId: CategoryId) => void;
};

export function getDefaultCategory(categoriesPresent: Set<string>): CategoryId {
  const firstMatch = CATEGORY_ORDER.find((category) => categoriesPresent.has(category));
  return firstMatch ?? CATEGORY_ORDER[0];
}

export function renderCategoryTabs(container: HTMLElement, options: CategoryTabsOptions): void {
  container.innerHTML = "";

  const tabList = document.createElement("div");
  tabList.className = "category-tabs";

  for (const categoryId of CATEGORY_ORDER) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-tabs__tab";
    button.textContent = categoryId;

    const isPresent = options.categoriesPresent.has(categoryId);
    button.disabled = !isPresent;

    if (categoryId === options.selectedCategory) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => options.onSelect(categoryId));
    tabList.appendChild(button);
  }

  container.appendChild(tabList);
}
