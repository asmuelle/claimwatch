import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseUsptoXml, decodeXmlEntities, UsptoParseError } from './parseUsptoXml';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', '..', 'fixtures', 'uspto');

function loadFixture(relativePath: string): string {
  return readFileSync(join(FIXTURES, relativePath), 'utf8');
}

describe('parseUsptoXml — grant documents', () => {
  const doc = parseUsptoXml(loadFixture('delta-tue/US12790314-B2.xml'));

  test('extracts bibliographic identity from publication-reference', () => {
    expect(doc.docId).toBe('US-12790314-B2');
    expect(doc.docNumber).toBe('12790314');
    expect(doc.kindCode).toBe('B2');
    expect(doc.publicationDate).toBe('2026-05-12');
  });

  test('extracts application number, title, and assignee', () => {
    expect(doc.applicationNumber).toBe('18123456');
    expect(doc.title).toBe(
      'Sparse mixture-of-experts routing for low-latency neural network inference',
    );
    expect(doc.assignee).toBe('Tensor Dynamics, Inc.');
  });

  test('assembles CPC symbols from structured classification-cpc elements', () => {
    expect(doc.cpcCodes).toEqual(['G06N3/08', 'G06N3/045']);
  });

  test('flattens nested claim-text into normalized claim bodies', () => {
    const claim1 = doc.claims[0];
    expect(claim1?.number).toBe(1);
    expect(claim1?.status).toBe('active');
    expect(claim1?.text).toContain('receiving an input token sequence at a gating network;');
    expect(claim1?.text).not.toMatch(/^1\./);
    expect(claim1?.text).not.toContain('<');
  });

  test('detects cancelled claims published as "(canceled)"', () => {
    const claim2 = doc.claims[1];
    expect(claim2?.status).toBe('cancelled');
  });

  test('reads claim dependencies from claim-ref idrefs', () => {
    const claim3 = doc.claims[2];
    expect(claim3?.dependsOn).toEqual([1]);
  });
});

describe('parseUsptoXml — pre-grant applications', () => {
  test('parses an A1 publication with applicant orgname as assignee', () => {
    // Arrange
    const xml = loadFixture('backfill/US20240123456-A1.xml');

    // Act
    const doc = parseUsptoXml(xml);

    // Assert
    expect(doc.docId).toBe('US-20240123456-A1');
    expect(doc.applicationNumber).toBe('18123456');
    expect(doc.assignee).toBe('Tensor Dynamics, Inc.');
    expect(doc.claims).toHaveLength(3);
    expect(doc.claims[1]?.dependsOn).toEqual([1]);
    expect(doc.claims[2]?.dependsOn).toEqual([2]);
  });
});

describe('parseUsptoXml — boundary validation', () => {
  test('throws UsptoParseError when the claims block is missing', () => {
    const xml = loadFixture('delta-tue/US12790314-B2.xml').replace(
      /<claims id="claims">[\s\S]*<\/claims>/,
      '',
    );
    expect(() => parseUsptoXml(xml)).toThrow(UsptoParseError);
  });

  test('throws UsptoParseError on a malformed publication date', () => {
    const xml = loadFixture('delta-tue/US12790314-B2.xml').replace(
      '<date>20260512</date>',
      '<date>2026-05-12</date>',
    );
    expect(() => parseUsptoXml(xml)).toThrow(/invalid date/);
  });

  test('throws UsptoParseError when doc-number fails schema validation', () => {
    const xml = loadFixture('delta-tue/US12790314-B2.xml').replace(
      '<doc-number>12790314</doc-number>',
      '<doc-number>ABC</doc-number>',
    );
    expect(() => parseUsptoXml(xml)).toThrow(UsptoParseError);
  });
});

describe('decodeXmlEntities', () => {
  test('decodes named and numeric entities', () => {
    expect(decodeXmlEntities('A &amp; B &lt;= &#x2019;C&#8217;')).toBe('A & B <= ’C’');
  });
});
