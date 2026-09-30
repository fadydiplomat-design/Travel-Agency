import { parseTicketText } from "./lib/ticketOcr.js";

const sample = `
TKT-0724830484371     RCI-     POI-ALY  DOI-09AUG26     1A  LOC-9D8KYZ
OD-CAICAI  SI-    FCMI-0  POI-ALY  DOI-09AUG26  IOI-90218376
 1.BOTROS/MARIA MISS        CHD     ST
 1 OCAI GF 70  X 14AUG1655 OK XALIT3EGC   F  14AUG14AUG 35K
 2 OBAH GF 71  N 26AUG1215 OK NCLIT3EGC   F  26AUG26AUG 35K
   CAI
 FARE   F USD        333.00
 EQUIV  EGP       16597.00
 TOTALTAX EGP     10061.80
 TOTAL  EGP       26658.80
 /FC CAI GF BAH196.80GF CAI101.20Q CAICAI35.00NUC333.00END ROE1.0
 0
 FE VALID ON GF ONLY/NON ENDO
 FP CASH
 FOR TAX/FEE DETAILS USE TWD/TAX
`;

const res = parseTicketText(sample);
console.log(JSON.stringify(res, null, 2));
console.log("\n--- Summary ---");
console.log("Passengers:", res.passengers);
console.log("TicketNr:", res.ticketNr);
console.log("PNR:", res.pnr);
console.log("From/To:", res.from, res.to);
console.log("Fare USD:", res.fareValue, res.fareCurrency);
console.log("Equiv EGP:", res._equiv, res.currency);
console.log("Taxes:", res.taxes);
console.log("Segments:", res.segments.length, JSON.stringify(res.segments,null,2));
console.log("Is CHD?", res.passengers[0]?.type);
console.log("BuyPrice:", res.buyPrice);
