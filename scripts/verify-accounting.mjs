// Run:  node --import ./scripts/register-alias.mjs scripts/verify-accounting.mjs
// Pure-logic checks for the Phase 0/1 accounting modules (no Firebase needed).
import assert from 'node:assert/strict';
const B = await import('../lib/reversalBuilders.js');
const P = await import('../lib/period.js');
const F = await import('../lib/fx.js');
const T = await import('../lib/tax.js');
const C = await import('../lib/chartOfAccounts.js');

// journal reversal nets to zero, keeps fx metadata, dated in a valid period
const orig = { date:'2026-03-10', branch:'2', memo:'Accrual', sourceType:'adjustment', status:'posted',
  lines:[{accountCode:'6100',debit:1000,credit:0},{accountCode:'2300',debit:0,credit:1000,currency:'USD',originalAmount:20,rate:50}]};
const rev = B.buildJournalReversal(orig,'J1',{reason:'wrong month',userName:'Nour',userUid:'u1',date:'2026-10-01'});
assert.equal(rev.sourceType,'reversal'); assert.equal(rev.fiscalYear,'26'); assert.equal(rev.branch,'2');
assert.equal(rev.totalDebit,1000); assert.equal(rev.totalCredit,1000);
assert.deepEqual(rev.lines.map(l=>[l.accountCode,l.debit,l.credit]),[['6100',0,1000],['2300',1000,0]]);
assert.equal(rev.lines[1].currency,'USD'); assert.equal(rev.reversalOf,'J1');
const net = {}; [...orig.lines,...rev.lines].forEach(l=>net[l.accountCode]=(net[l.accountCode]||0)+l.debit-l.credit);
assert.deepEqual(net,{'6100':0,'2300':0});
// guards
assert.throws(()=>B.buildJournalReversal(orig,'J1',{reason:' ',date:'2026-10-01'}),/reason/i);
assert.throws(()=>B.assertReversibleJournal({...orig,status:'reversed'}),/already been reversed/);
assert.throws(()=>B.assertReversibleJournal({...orig,sourceType:'treasury'}),/voiding the voucher/);
assert.throws(()=>B.assertReversibleJournal({...orig,sourceType:'reversal'}),/can't itself be reversed/);
assert.throws(()=>B.buildJournalReversal({...orig,lines:[{accountCode:'1',debit:5,credit:0}]},'J',{reason:'xxx',date:'2026-10-01'}),/not balanced/);
// bank reversal
const bank={type:'in',amount:500,currency:'EGP',account:'1010',contraAccount:'1100',memo:'Dep',cleared:false,status:'active',branch:'1',date:'2026-02-01'};
const br=B.buildBankReversal(bank,'B1',{reason:'duplicate',date:'2026-10-01'});
assert.equal(br.type,'out'); assert.equal(br.amount,500); assert.equal(br.cleared,true); assert.equal(br.status,'reversal'); assert.equal(br.fiscalYear,'26');
assert.throws(()=>B.buildBankReversal({...bank,cleared:true},'B1',{reason:'dup',date:'2026-10-01'}),/already matched/);
assert.throws(()=>B.buildBankReversal({...bank,status:'voided'},'B1',{reason:'dup',date:'2026-10-01'}),/already voided/);
// reconciliation summary stays right after a void pair
// period
assert.deepEqual(P.periodStamp('2025-12-31','3'),{date:'2025-12-31',branch:'3',fiscalYear:'25'});
assert.equal(P.isPeriodClosed(new Set(['1_25']),'2025-06-01','1'),true);
assert.equal(P.isPeriodClosed(new Set(['1_25']),'2026-06-01','1'),false);
// fx
assert.equal(F.toBase(100,48.55),4855);
assert.equal(F.rateOn([{currency:'USD',date:'2026-09-01',rate:48},{currency:'USD',date:'2026-09-15',rate:49}],'USD','2026-09-20'),49);
assert.equal(F.rateOn([],'USD','2026-09-20'),null); assert.equal(F.rateOn([], 'EGP','2026-09-20'),1);
assert.equal(F.realizedFx({originalAmount:1000,bookedRate:48,settleRate:49,side:'receivable'}),1000);
assert.equal(F.realizedFx({originalAmount:1000,bookedRate:48,settleRate:49,side:'payable'}),-1000);
assert.equal(F.revaluationAdjustment({foreignBalance:1000,bookValueEGP:48000,closeRate:49.5}),1500);
const lines=F.realizedFxLines(-300,'2000','6800'); assert.deepEqual(lines.map(l=>[l.accountCode,l.debit,l.credit]),[['6800',300,0],['2000',0,300]]);
// tax
assert.deepEqual(T.splitVat(114,'VAT14',true),{net:100,vat:14,gross:114,rate:14,taxCode:'VAT14'});
assert.equal(T.splitVat(100,'VAT14').gross,114); assert.equal(T.splitVat(100,'EXEMPT').vat,0);
// COA integrity
const codes=C.CHART_OF_ACCOUNTS.map(a=>a.code); assert.equal(new Set(codes).size,codes.length);
for (const k of Object.values(C.SYSTEM_ACCOUNTS)) assert.ok(C.ACCOUNT_BY_CODE[k],'missing '+k);
assert.equal(C.treasuryAccountCode('cash','USD'),'1001'); assert.equal(C.modernTreasuryCode('1000','USD'),'1001');
assert.equal(C.findLegacyTreasuryVouchers([{treasuryAccount:'1000',currency:'USD'},{treasuryAccount:'1000',currency:'EGP'}]).length,1);

// bank reversal keeps FX so the pair nets to zero in EGP
const fxBank={type:'out',amount:100,currency:'USD',exchangeRate:49,baseAmount:4900,account:'1020',cleared:false,status:'active',branch:'1',date:'2026-02-01'};
const fxRev=B.buildBankReversal(fxBank,'B2',{reason:'dup',date:'2026-10-01'});
assert.equal(fxRev.baseAmount,4900); assert.equal(fxRev.exchangeRate,49); assert.equal(fxRev.type,'in');
// role defaults: segregation of duties
const PM = await import('../lib/permissions.js');
const can=(role,k)=>[PM.canAccessAccountingArea({role},k,false,{}),PM.canWriteAccountingArea({role},k,false,{})];
assert.deepEqual(can('Cashier','treasury'),[true,true]);
for (const k of ['journals','bankBook','reconciliation','voids','adjustments','financialReports']) assert.deepEqual(can('Cashier',k),[false,false],'cashier '+k);
for (const k of ['voids','treasuryApprove','fiscalYear']) assert.equal(can('Accountant',k)[1],false,'accountant '+k);
assert.equal(can('Accountant','journals')[1],true);
assert.equal(can('Cost Accountant','journals')[1],false);
for (const k of ['voids','treasuryApprove','fxRates','journals','treasury']) assert.equal(can('Financial Controller',k)[1],true,'controller '+k);
assert.equal(PM.isSelfApproval('u1','u1'),true); assert.equal(PM.isSelfApproval('u1','u2'),false);
console.log('ALL PASS');

// ───── Phase 2 ─────
{
  const RM = await import('../lib/reconMath.js');
  const TT = await import('../lib/treasuryTieOut.js');
  assert.equal(RM.monthEndISO('2026-02'),'2026-02-28'); assert.equal(RM.monthEndISO('2028-02'),'2028-02-29'); assert.equal(RM.monthEndISO('2026-12'),'2026-12-31');
  // March: deposit 1000 cleared in March; cheque -300 dated Mar 30 clears in April; fee -20 on statement posted from statement
  const bank=[
    {id:'a',date:'2026-03-05',type:'in',amount:1000,cleared:true,status:'active'},
    {id:'b',date:'2026-03-30',type:'out',amount:300,cleared:true,status:'active'},
    {id:'c',date:'2026-04-02',type:'in',amount:50,cleared:false,status:'active'},
  ];
  const st=[
    {id:'s1',date:'2026-03-06',amount:1000,matchedBankLineId:'a'},
    {id:'s2',date:'2026-04-03',amount:-300,matchedBankLineId:'b'},
  ];
  const r=RM.reconciliationAsOf({bankLines:bank,statementLines:st,asOf:'2026-03-31',statementEndingBalance:1000});
  assert.equal(r.bookBalance,700); assert.equal(r.outstandingWithdrawals,300); assert.equal(r.adjustedBookBalance,1000);
  assert.equal(r.difference,0); assert.equal(r.reconciled,true); assert.equal(r.unmatchedStatement.length,0);
  // same data viewed as of April end: cheque no longer outstanding, deposit c is
  const r2=RM.reconciliationAsOf({bankLines:bank,statementLines:st,asOf:'2026-04-30',statementEndingBalance:700});
  assert.equal(r2.outstandingWithdrawals,0); assert.equal(r2.outstandingDeposits,50); assert.equal(r2.difference,0);
  // a voided deposit in April, voided on May 3: April-end reconciliation still sees it as outstanding
  const bank3=[{id:'v',date:'2026-04-10',type:'in',amount:200,cleared:true,status:'voided',reversalLineId:'vr'},
               {id:'vr',date:'2026-05-03',type:'out',amount:200,cleared:true,status:'reversal',reversalOf:'v'}];
  const r3=RM.reconciliationAsOf({bankLines:bank3,statementLines:[],asOf:'2026-04-30',statementEndingBalance:0});
  assert.equal(r3.bookBalance,200); assert.equal(r3.outstandingDeposits,200); assert.equal(r3.difference,0);
  const r4=RM.reconciliationAsOf({bankLines:bank3,statementLines:[],asOf:'2026-05-31',statementEndingBalance:0});
  assert.equal(r4.bookBalance,0); assert.equal(r4.outstanding.length,0); assert.equal(r4.difference,0);
  // blockers
  const bad=RM.buildCloseSnapshot({account:'1010',month:'2026-03',bankLines:bank,statementLines:[...st,{id:'s3',date:'2026-03-31',amount:-20,matchedBankLineId:null}],statementEndingBalance:980});
  assert.ok(bad.blockers.some(x=>x.includes('لسه مش متطابقة'))); 
  const ok=RM.buildCloseSnapshot({account:'1010',month:'2026-03',bankLines:bank,statementLines:st,statementEndingBalance:1000});
  assert.deepEqual(ok.blockers,[]); assert.equal(ok.snapshot.outstandingCount,1); assert.equal(RM.closeDocId('1010','2026-03'),'1010_2026-03');
  assert.ok(RM.buildCloseSnapshot({account:'1010',month:'2026-03',bankLines:bank,statementLines:st,statementEndingBalance:''}).blockers.length>0);
  // treasury tie-out
  const accts=[{code:'1000',currency:'EGP',name:'c',kind:'cash'},{code:'1001',currency:'USD',name:'u',kind:'cash'}];
  const vouchers=[{status:'posted',type:'receipt',amount:500,treasuryAccount:'1000',currency:'EGP'},
                  {status:'posted',type:'payment',amount:100,treasuryAccount:'1000',currency:'EGP'},
                  {status:'void',type:'receipt',amount:999,treasuryAccount:'1000',currency:'EGP'},
                  {status:'posted',type:'receipt',amount:20,treasuryAccount:'1001',currency:'USD'},
                  {status:'posted',type:'receipt',amount:7,treasuryAccount:'1000',currency:'USD'}];
  const journals=[{sourceType:'treasury',lines:[{accountCode:'1000',debit:500,credit:0},{accountCode:'1100',debit:0,credit:500}]},
                  {sourceType:'treasury',lines:[{accountCode:'1000',debit:0,credit:100}]},
                  {sourceType:'treasury',lines:[{accountCode:'1001',debit:1000,credit:0,currency:'USD',originalAmount:20,rate:50}]}];
  const t=TT.tieOut({accounts:accts,balances:[{id:'1000_EGP',balance:400},{id:'1001_USD',balance:20}],vouchers,journals});
  assert.equal(t.rows[0].leg1,0); assert.equal(t.rows[0].leg2,0); assert.equal(t.rows[1].ledger,20); assert.ok(t.rows.every(r=>r.ok)); assert.equal(t.legacy,1);
  const t2=TT.tieOut({accounts:accts,balances:[{id:'1000_EGP',balance:450},{id:'1001_USD',balance:20}],vouchers,journals:[]});
  assert.equal(t2.rows[0].leg1,50); assert.equal(t2.rows[0].ok,false); assert.equal(t2.rows[0].leg2,null); assert.equal(t2.ledgerAvailable,false);
  assert.equal(TT.countDifference(400,395),-5); assert.equal(TT.dayCloseDocId('2','1000','2026-10-02'),'2_1000_2026-10-02');
  console.log('PHASE 2 PASS');
}

// ───── Rules ⇄ permissions.js parity: defaultRoles / readOnlyRoles must match ─────
{
  const fs = await import('node:fs');
  const PM = await import('../lib/permissions.js');
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const parseList = (str) => [...str.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  let checked = 0;
  for (const m of PM.PERMISSION_MODULES.filter((x) => x.subOf || ['accounts', 'fiscalYear'].includes(x.key))) {
    const line = rules.split('\n').find((l) => new RegExp(`moduleKey == '${m.key}'\\s*\\?`).test(l) && l.includes('['));
    assert.ok(line, 'rules missing defaultRoles for ' + m.key);
    const fromRules = parseList(line.slice(line.indexOf('[')));
    assert.deepEqual(fromRules, [...m.defaultRoles].sort(), 'defaultRoles drift for ' + m.key);
    checked++;
  }
  // readOnlyRoles parity (the readOnlyRoles() function in the rules)
  const roStart = rules.indexOf('function readOnlyRoles');
  const roBlock = rules.slice(roStart, rules.indexOf('function readOnlyForRole'));
  for (const m of PM.PERMISSION_MODULES.filter((x) => x.subOf && x.readOnlyRoles)) {
    const line = roBlock.split('\n').find((l) => new RegExp(`moduleKey == '${m.key}'\\s*\\?`).test(l));
    assert.ok(line, 'rules missing readOnlyRoles for ' + m.key);
    assert.deepEqual(parseList(line.slice(line.indexOf('['))), [...m.readOnlyRoles].sort(), 'readOnlyRoles drift for ' + m.key);
  }
  // every sub-key referenced by acct()/acctW() in the rules exists in permissions.js
  const keys = new Set(PM.PERMISSION_MODULES.map((x) => x.key));
  const used = new Set([...rules.matchAll(/acctW?\('([A-Za-z]+)'\)/g)].map((m) => m[1]));
  for (const k of used) assert.ok(keys.has(k), 'rules use unknown permission key ' + k);
  console.log(`RULES PARITY PASS (${checked} modules, ${used.size} keys used)`);
}

// ───── Phase 3 ─────
{
  const JF = await import('../lib/journalFx.js');
  const RV = await import('../lib/revaluation.js');
  const rates=[{currency:'USD',date:'2026-03-01',rate:48},{currency:'USD',date:'2026-03-31',rate:50}];
  // USD 100 cash in (rate from table) vs EGP revenue 4800 on 2026-03-10
  const ok=JF.normalizeJournalLines([
    {accountCode:'1001',debit:'100',credit:'',currency:'USD'},
    {accountCode:'4400',debit:'',credit:'4800',currency:'EGP'}],{rates,date:'2026-03-10'});
  assert.deepEqual(ok.errors,[]); assert.equal(ok.lines[0].debit,4800); assert.equal(ok.lines[0].originalAmount,100); assert.equal(ok.lines[0].rate,48);
  assert.equal(ok.totals.balanced,true); assert.equal(ok.lines[1].currency,undefined);
  // wrong currency on a bound account, foreign on revenue, missing rate
  assert.ok(JF.normalizeJournalLines([{accountCode:'1001',debit:'10',currency:'EGP'}],{rates,date:'2026-03-10'}).errors[0].includes('بعملة USD'));
  assert.ok(JF.normalizeJournalLines([{accountCode:'4400',credit:'10',currency:'USD'}],{rates,date:'2026-03-10'}).errors[0].includes('بالجنيه فقط'));
  assert.ok(JF.normalizeJournalLines([{accountCode:'1020',debit:'10',currency:'EUR'}],{rates,date:'2026-03-10'}).errors.length>0);
  assert.ok(JF.normalizeJournalLines([{accountCode:'1001',debit:'10',currency:'USD'}],{rates:[],date:'2026-03-10'}).errors[0].includes('سعر صرف'));
  assert.equal(JF.normalizeJournalLines([{accountCode:'1001',debit:'10',currency:'USD',rate:'49'},{accountCode:'4400',credit:'490'}],{rates:[],date:'2026-03-10'}).totals.balanced,true);
  // revaluation: 100 USD booked at 48 = 4800; close 50 -> +200 gain
  const ledger=[{accountCode:'1001',debit:4800,credit:0,currency:'USD',originalAmount:100,date:'2026-03-10',sourceType:'manual'},
                {accountCode:'1001',debit:0,credit:1000,currency:'USD',originalAmount:20,date:'2026-03-12',sourceType:'treasury'},
                {accountCode:'1001',debit:5,credit:0,date:'2026-03-15',sourceType:'manual'}]; // legacy unstamped
  let rows=RV.computeRevaluation({ledgerLines:ledger,rates,asOf:'2026-03-31'});
  const r1=rows.find(r=>r.code==='1001');
  assert.equal(r1.foreignBalance,80); assert.equal(r1.bookEGP,3800); assert.equal(r1.adjustment,200); assert.equal(r1.unstamped,1);
  assert.equal(rows.find(r=>r.code==='1002').missingRate,true); assert.equal(rows.find(r=>r.code==='1002').adjustment,null);
  const lines=RV.buildRevaluationLines(rows);
  assert.deepEqual(lines.map(l=>[l.accountCode,l.debit,l.credit]),[['1001',200,0],['6810',0,200]]);
  // posting it then re-running gives zero (idempotent), and a rate drop gives a loss
  const posted=[...ledger,{accountCode:'1001',debit:200,credit:0,date:'2026-03-31',sourceType:'revaluation'}];
  rows=RV.computeRevaluation({ledgerLines:posted,rates,asOf:'2026-03-31'});
  assert.equal(rows.find(r=>r.code==='1001').adjustment,0); assert.deepEqual(RV.buildRevaluationLines(rows),[]);
  rows=RV.computeRevaluation({ledgerLines:posted,rates:[...rates,{currency:'USD',date:'2026-04-30',rate:49}],asOf:'2026-04-30'});
  assert.equal(rows.find(r=>r.code==='1001').adjustment,-80);
  const loss=RV.buildRevaluationLines(rows); assert.deepEqual(loss.map(l=>[l.accountCode,l.debit,l.credit]),[['6810',80,0],['1001',0,80]]);
  console.log('PHASE 3 PASS');
}

// ───── Phase 4 ─────
{
  const H = await import('../lib/accountingHealth.js');
  // suspense FIFO: Dr 100 (Jan 1), Dr 50 (Mar 1), Cr 120 (Mar 10) -> clears Jan 100 + 20 of Mar; left 30 dated Mar 1
  const L=[{accountCode:'1900',date:'2026-01-01',debit:100,credit:0},{accountCode:'1900',date:'2026-03-01',debit:50,credit:0},{accountCode:'1900',date:'2026-03-10',debit:0,credit:120},{accountCode:'1000',date:'2026-03-10',debit:999,credit:0}];
  const s=H.suspenseAgeing(L,'2026-03-31');
  assert.equal(s.balance,30); assert.equal(s.buckets['0-30'],30); assert.equal(s.oldestDate,'2026-03-01'); assert.equal(s.buckets['61+'],0);
  assert.equal(H.suspenseAgeing(L,'2026-06-30').buckets['61+'],30);
  assert.equal(H.suspenseAgeing([{accountCode:'1900',date:'2026-03-01',debit:0,credit:40}],'2026-03-31').balance,-40);
  // stale outstanding
  const so=H.staleOutstanding([{date:'2026-01-01',cleared:false,status:'active'},{date:'2026-03-20',cleared:false},{date:'2026-01-01',cleared:true},{date:'2026-01-01',cleared:false,status:'voided'}],'2026-03-31');
  assert.equal(so.length,1);
  // coverage: go-live 2026-01, today in April -> expects Jan..Mar signed
  const cov=H.reconciliationCoverage([{account:'1010',month:'2026-01',status:'signed'},{account:'1010',month:'2026-03',status:'signed'},{account:'1010',month:'2026-02',status:'prepared'}],['1010','1020'],'2026-04-15','2026-01');
  assert.deepEqual(cov[0],{account:'1010',lastSigned:'2026-03',behind:1}); assert.equal(cov[1].behind,3); assert.equal(cov[1].lastSigned,null);
  assert.equal(H.reconciliationCoverage([],['1010'],'2026-04-15','').at(0).behind,0);
  // year boundary
  assert.equal(H.reconciliationCoverage([],['1010'],'2027-01-10','2026-11')[0].behind,2);
  // corrections log
  const log=H.correctionsLog({journals:[{status:'reversed',memo:'Rent',reversedBy:'Nour',reversalReason:'dup',reversedAt:'2026-03-02T10:00:00Z'}],bankLines:[{status:'voided',amount:5,currency:'USD',voidedBy:'Sam',voidReason:'x',voidedAt:'2026-03-05T10:00:00Z'}],vouchers:[{status:'void',voucherNumber:'R-1',voidedBy:'Mo',voidReason:'y',voidedAt:'2026-02-01T10:00:00Z'}],closes:[{account:'1010',month:'2026-02',reopenCount:1,reopenedBy:'Ctl',reopenReason:'z',reopenedAt:'2026-03-09T10:00:00Z'}]});
  assert.equal(log.length,4); assert.equal(log[0].kind,'إعادة فتح تسوية'); assert.equal(log[3].kind,'سند خزينة ملغي');
  assert.equal(H.correctionsLog({journals:[],bankLines:[],vouchers:[],closes:[{reopenCount:1,reopenedAt:'2026-01-01T00:00:00Z'}],sinceDate:'2026-02-01'}).length,0);
  // readiness
  const rd=H.readiness({policy:{approvalLimits:{EGP:50000,USD:1500}},rates:[{currency:'USD',date:'2026-03-31'}],today:'2026-03-31',legacyCount:2,unstampedForeign:0,hasController:false});
  assert.deepEqual(rd.map(r=>r.ok),[false,false,false,true,false]);
  assert.ok(H.readiness({policy:{approvalLimits:{EGP:1,USD:1,EUR:1}},rates:[{currency:'USD',date:'d'},{currency:'EUR',date:'d'}],today:'d',legacyCount:0,unstampedForeign:0,hasController:true}).every(r=>r.ok));
  console.log('PHASE 4 PASS');
}
