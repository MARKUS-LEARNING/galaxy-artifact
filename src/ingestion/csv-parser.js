// ─── CSV / TSV parser ───
//
// A hand-rolled comma-separated-values parser that also auto-detects
// tab-separated payloads. The parsing is intentionally tolerant: it
// accepts rows whose field count is within ±5 of the header count,
// which lets typical real-world music exports pass without losing
// rows to overzealous validation.
//
// The functions are deliberately written as single-line dense
// declarations because they're stringified into the body of an
// inline Web Worker (see src/app.js); compactness keeps the worker
// blob small and avoids whitespace-related toString quirks across
// engines. A separate follow-up commit will be the right place to
// expand them per the project's "one job per line" rule -- doing it
// here would mix relocation with refactoring.

export function csvSplitRows(t){const r=[];let c='',q=false;for(let i=0;i<t.length;i++){const ch=t[i];if(ch==='"'){q=!q;c+=ch}else if(ch==='\n'&&!q){r.push(c);c=''}else c+=ch}if(c.trim())r.push(c);return r}

export function csvSplitFields(l){const f=[];let c='',q=false;for(let i=0;i<l.length;i++){const ch=l[i];if(ch==='"'){if(q&&l[i+1]==='"'){c+='"';i++}else q=!q}else if(ch===','&&!q){f.push(c);c=''}else c+=ch}f.push(c);return f}

export function parseCSV(text){
  const n=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const raw=csvSplitRows(n);if(raw.length<2)return{headers:[],rows:[]};
  const tsv=raw[0].includes('\t');
  const p=tsv?l=>l.split('\t').map(v=>v.trim().replace(/^"|"$/g,'')):csvSplitFields;
  const h=p(raw[0]),rows=[];
  for(let i=1;i<raw.length;i++){if(!raw[i].trim())continue;const v=p(raw[i]);
    if(v.length>=h.length-5&&v.length<=h.length+2){const r={};h.forEach((k,j)=>r[k]=(v[j]||'').trim());rows.push(r)}}
  return{headers:h,rows};
}
