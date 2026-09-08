import {mkdir,writeFile} from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
await mkdir('tests/fixtures',{recursive:true});
await writeFile('tests/fixtures/sample.csv','Item,Amount\nRent,1200\nFood,300\n');
await writeFile('tests/fixtures/sample.docx',zipSync({'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A local document. The project deadline is September 30.</w:t></w:r></w:p></w:body></w:document>')}));
await writeFile('tests/fixtures/sample.xlsx',zipSync({'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData><row><c r="A1"><v>42</v></c></row></sheetData></worksheet>')}));
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
const stream='BT /F1 18 Tf 60 700 Td (Navi local PDF extraction test: revenue 4200) Tj ET';objects.push('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+object+'\nendobj\n';});const start=pdf.length;pdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';await writeFile('tests/fixtures/sample.pdf',pdf);
