// Chargement à la demande des bibliothèques lourdes (Excel, PDF, glisser-déposer) :
// la page s'ouvre sans les télécharger.

const URLS = {
  exceljs: ["https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"],
  jspdf: ["https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js"],
  sortable: ["https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.6/Sortable.min.js"],
};
const cache = {};

function script(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("Bibliothèque indisponible : " + src.split("/").slice(-1)[0]));
    document.head.appendChild(el);
  });
}

function load(name) {
  cache[name] ||= URLS[name].reduce((p, src) => p.then(() => script(src)), Promise.resolve())
    .catch((e) => { delete cache[name]; throw e; });
  return cache[name];
}

export const loadExcel = () => load("exceljs").then(() => window.ExcelJS);
export const loadPdf = () => load("jspdf").then(() => window.jspdf.jsPDF);
export const loadSortable = () => load("sortable").then(() => window.Sortable);

/** Propose le téléchargement d'un fichier généré dans le navigateur. */
export function telecharger(data, nom, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
