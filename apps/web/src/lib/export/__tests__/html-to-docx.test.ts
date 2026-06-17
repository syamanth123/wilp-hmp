import { describe, it, expect } from 'vitest';
import { Document, Packer } from 'docx';
import AdmZip from 'adm-zip';
import { htmlToParagraphs } from '../html-to-docx';

/**
 * Packs the converter's paragraphs into a real .docx and returns word/document.xml.
 * Asserting on the actual OOXML is the only faithful check of docx output.
 */
async function toXml(html: string): Promise<string> {
  const doc = new Document({ sections: [{ children: htmlToParagraphs(html) }] });
  const buf = await Packer.toBuffer(doc);
  return new AdmZip(buf).readAsText('word/document.xml');
}

describe('htmlToParagraphs — TipTap allowlist coverage', () => {
  it('empty / whitespace input → no paragraphs', () => {
    expect(htmlToParagraphs('')).toHaveLength(0);
    expect(htmlToParagraphs('   ')).toHaveLength(0);
    expect(htmlToParagraphs(null)).toHaveLength(0);
    expect(htmlToParagraphs(undefined)).toHaveLength(0);
  });

  it('the corpus-empirical case: only <p> (588/588 occurrences)', () => {
    const paras = htmlToParagraphs('<p>First paragraph.</p><p>Second paragraph.</p>');
    expect(paras).toHaveLength(2);
  });

  it('<strong>/<b> → bold run', async () => {
    expect(await toXml('<p>a <strong>bold</strong> b</p>')).toContain('<w:b/>');
    expect(await toXml('<p><b>x</b></p>')).toContain('<w:b/>');
  });

  it('<em>/<i> → italic run', async () => {
    expect(await toXml('<p><em>x</em></p>')).toContain('<w:i/>');
    expect(await toXml('<p><i>y</i></p>')).toContain('<w:i/>');
  });

  it('<u> → underline run', async () => {
    expect(await toXml('<p><u>x</u></p>')).toContain('<w:u ');
  });

  it('<code> → monospace (Courier New) run', async () => {
    expect(await toXml('<p><code>x()</code></p>')).toContain('Courier New');
  });

  it('nested <strong><em> → run is both bold AND italic', async () => {
    const xml = await toXml('<p><strong><em>x</em></strong></p>');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
  });

  it('<ul><li> → docx bullets (numPr)', async () => {
    const xml = await toXml('<ul><li>one</li><li>two</li></ul>');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('one');
    expect(xml).toContain('two');
  });

  it('<ol><li> → manual "N. " number prefixes', async () => {
    const xml = await toXml('<ol><li>first</li><li>second</li></ol>');
    expect(xml).toContain('1. ');
    expect(xml).toContain('2. ');
  });

  it('<br> → in-paragraph line break', async () => {
    expect(await toXml('<p>line1<br>line2</p>')).toContain('<w:br/>');
  });

  it('<a> with safe scheme → hyperlink; text preserved', async () => {
    const xml = await toXml('<p>see <a href="https://elearn.bits-pilani.ac.in">portal</a></p>');
    expect(xml).toContain('<w:hyperlink');
    expect(xml).toContain('portal');
  });

  it('<a> with unsafe scheme → rendered as plain text, no hyperlink', async () => {
    const xml = await toXml('<p><a href="javascript:alert(1)">click</a></p>');
    expect(xml).not.toContain('<w:hyperlink');
    expect(xml).toContain('click');
  });

  it('<span> is a transparent passthrough', async () => {
    expect(await toXml('<p><span>plain</span></p>')).toContain('plain');
  });

  it('loose text outside <p> is still captured in a paragraph', async () => {
    const xml = await toXml('orphan text');
    expect(xml).toContain('orphan text');
  });

  it('tolerates unclosed tags without throwing', () => {
    expect(() => htmlToParagraphs('<p>unterminated <strong>bold')).not.toThrow();
  });

  it('decodes HTML entities', async () => {
    expect(await toXml('<p>A &amp; B &lt; C</p>')).toContain('A &amp; B &lt; C');
  });
});
