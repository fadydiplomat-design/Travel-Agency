// Generic report export helpers.
//
// Both functions work directly off a rendered <table> DOM node, so they
// export EXACTLY what the user currently sees on screen — same filters,
// same date range, same columns — no separate data-mapping to maintain
// per report.

export function findReportTable(container) {
  if (!container) return null;
  return container.querySelector("table");
}

export async function exportTableToExcel(container, filename = "report", sheetName = "Report") {
  const table = findReportTable(container);
  if (!table) return false;
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.table_to_book(table, { sheet: sheetName.slice(0, 31) || "Report" });
  XLSX.writeFile(wb, `${filename}.xlsx`);
  return true;
}

export async function exportTableToPDF(container, filename = "report", title = "") {
  const table = findReportTable(container);
  if (!table) return false;
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const { companyProfile } = await import("./companyProfile");

  // Landscape usually fits accounting-style tables (lots of columns) better.
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  let startY = 20;
  if (companyProfile.name) {
    doc.setFontSize(13);
    doc.setTextColor(30, 41, 59);
    doc.text(companyProfile.name, 24, 22);
    startY = 34;
  }
  if (title) {
    doc.setFontSize(11);
    doc.setTextColor(companyProfile.name ? 100 : 0);
    doc.text(title, 24, startY + 10);
    startY += 22;
  }

  autoTable(doc, {
    html: table,
    startY,
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235] }, // brand blue-600
    margin: { left: 20, right: 20 },
  });

  doc.save(`${filename}.pdf`);
  return true;
}
