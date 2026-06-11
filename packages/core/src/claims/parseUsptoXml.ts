/**
 * Parser for USPTO full-text XML excerpts (us-patent-grant / us-patent-application).
 *
 * Scope: the bibliographic fields and the claims block that ClaimWatch needs.
 * The claim diff engine consumes ONLY canonical text extracted here — no LLM is
 * involved anywhere in parsing or diffing (product invariant 1).
 *
 * Every parsed document is validated with zod at the boundary (AGENTS.md:
 * never trust feed data shape).
 */
import { z } from 'zod';
import type { ParsedClaim, ParsedDocument } from './types';
import { buildDocId } from './types';
import { normalizeClaimText, parseClaimBody } from './normalizeClaim';

export class UsptoParseError extends Error {
  constructor(
    message: string,
    readonly context: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'UsptoParseError';
  }
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/** Decodes the small set of entities that appear in USPTO full-text XML. */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m);
}

/** Returns the inner text of the first `<tag ...>...</tag>` occurrence, or undefined. */
function sliceTag(xml: string, tag: string): string | undefined {
  const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`);
  const openMatch = openRe.exec(xml);
  if (!openMatch) return undefined;
  const start = openMatch.index + openMatch[0].length;
  const end = xml.indexOf(`</${tag}>`, start);
  if (end === -1) return undefined;
  return xml.slice(start, end);
}

/** Returns inner texts of all non-nested `<tag ...>...</tag>` occurrences. */
function sliceAllTags(xml: string, tag: string): readonly string[] {
  const out: string[] = [];
  const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g');
  let m = openRe.exec(xml);
  while (m !== null) {
    const start = m.index + m[0].length;
    const end = xml.indexOf(`</${tag}>`, start);
    if (end === -1) break;
    out.push(xml.slice(start, end));
    openRe.lastIndex = end;
    m = openRe.exec(xml);
  }
  return out;
}

function requireTag(xml: string, tag: string, docContext: string): string {
  const value = sliceTag(xml, tag);
  if (value === undefined) {
    throw new UsptoParseError(`missing <${tag}> element`, { tag, doc: docContext });
  }
  return value;
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;

function toIsoDate(raw: string, docContext: string): string {
  const m = DATE_RE.exec(raw.trim());
  if (!m) {
    throw new UsptoParseError(`invalid date "${raw}" (expected yyyymmdd)`, { doc: docContext });
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

interface CpcParts {
  readonly section: string;
  readonly klass: string;
  readonly subclass: string;
  readonly mainGroup: string;
  readonly subgroup: string;
}

function parseCpcBlock(block: string): CpcParts | undefined {
  const section = sliceTag(block, 'section');
  const klass = sliceTag(block, 'class');
  const subclass = sliceTag(block, 'subclass');
  const mainGroup = sliceTag(block, 'main-group');
  const subgroup = sliceTag(block, 'subgroup');
  if (!section || !klass || !subclass || !mainGroup || !subgroup) return undefined;
  return { section, klass, subclass, mainGroup, subgroup };
}

function extractCpcCodes(xml: string): readonly string[] {
  const blocks = sliceAllTags(xml, 'classification-cpc');
  const codes: string[] = [];
  for (const block of blocks) {
    const parts = parseCpcBlock(block);
    if (parts) {
      codes.push(`${parts.section}${parts.klass}${parts.subclass}${parts.mainGroup}/${parts.subgroup}`);
    }
  }
  return codes;
}

const CLAIM_NUM_ATTR_RE = /num="(\d+)"/;
const CLAIM_REF_RE = /<claim-ref\s+idref="CLM-(\d+)"[^>]*>/g;

function parseClaimBlock(attrs: string, inner: string): ParsedClaim {
  const numMatch = CLAIM_NUM_ATTR_RE.exec(attrs);
  if (!numMatch || numMatch[1] === undefined) {
    throw new UsptoParseError('claim element without num attribute', { attrs });
  }
  const number = parseInt(numMatch[1], 10);
  const dependsOn: number[] = [];
  let refMatch = CLAIM_REF_RE.exec(inner);
  while (refMatch !== null) {
    if (refMatch[1] !== undefined) dependsOn.push(parseInt(refMatch[1], 10));
    refMatch = CLAIM_REF_RE.exec(inner);
  }
  CLAIM_REF_RE.lastIndex = 0;
  // Tags flatten to the empty string: USPTO claim XML separates block elements
  // with whitespace, and inline <claim-ref> text flows directly into the claim
  // (e.g. "of <claim-ref ...>claim 1</claim-ref>, wherein" -> "of claim 1, wherein").
  const flat = decodeXmlEntities(inner.replace(/<[^>]+>/g, ''));
  const body = parseClaimBody(normalizeClaimText(flat));
  return { number, text: body.text, status: body.status, dependsOn };
}

/** Extracts `<claim ...>` blocks. `</claim>` is an exact match and never collides with `</claim-text>`. */
function extractClaims(xml: string, docContext: string): readonly ParsedClaim[] {
  const claimsSection = requireTag(xml, 'claims', docContext);
  const claims: ParsedClaim[] = [];
  const openRe = /<claim\s([^>]*)>/g;
  let m = openRe.exec(claimsSection);
  while (m !== null) {
    const start = m.index + m[0].length;
    const end = claimsSection.indexOf('</claim>', start);
    if (end === -1) {
      throw new UsptoParseError('unterminated <claim> element', { doc: docContext });
    }
    claims.push(parseClaimBlock(m[1] ?? '', claimsSection.slice(start, end)));
    openRe.lastIndex = end;
    m = openRe.exec(claimsSection);
  }
  return claims;
}

const parsedDocumentSchema = z.object({
  source: z.literal('USPTO'),
  docId: z.string().min(5),
  docNumber: z.string().regex(/^\d{7,11}$/, 'doc-number must be 7-11 digits'),
  kindCode: z.string().regex(/^[AB]\d$/, 'kind code must look like A1/B2'),
  applicationNumber: z.string().regex(/^\d{8}$/, 'application serial must be 8 digits'),
  publicationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(3),
  assignee: z.string().min(2),
  cpcCodes: z.array(z.string().regex(/^[A-H]\d{2}[A-Z]\d+\/\d+$/)).min(1),
  claims: z
    .array(
      z.object({
        number: z.number().int().positive(),
        text: z.string().min(1),
        status: z.enum(['active', 'cancelled']),
        dependsOn: z.array(z.number().int().positive()),
      }),
    )
    .min(1),
});

/**
 * Parses one USPTO full-text XML document (grant or pre-grant publication).
 * Throws UsptoParseError on malformed input — a silently skipped document is
 * a recall incident, never a warning (product invariant 6).
 */
export function parseUsptoXml(xml: string): ParsedDocument {
  const fileHint = /file="([^"]+)"/.exec(xml)?.[1] ?? 'unknown-file';
  const pubRef = requireTag(xml, 'publication-reference', fileHint);
  const docNumber = requireTag(pubRef, 'doc-number', fileHint).trim();
  const kindCode = requireTag(pubRef, 'kind', fileHint).trim();
  const publicationDate = toIsoDate(requireTag(pubRef, 'date', fileHint), fileHint);
  const appRef = requireTag(xml, 'application-reference', fileHint);
  const applicationNumber = requireTag(appRef, 'doc-number', fileHint).trim();
  const title = normalizeClaimText(decodeXmlEntities(requireTag(xml, 'invention-title', fileHint)));
  const assignee = normalizeClaimText(decodeXmlEntities(requireTag(xml, 'orgname', fileHint)));

  const candidate: ParsedDocument = {
    source: 'USPTO',
    docId: buildDocId(docNumber, kindCode),
    docNumber,
    kindCode,
    applicationNumber,
    publicationDate,
    title,
    assignee,
    cpcCodes: extractCpcCodes(xml),
    claims: extractClaims(xml, fileHint),
  };

  const result = parsedDocumentSchema.safeParse(candidate);
  if (!result.success) {
    throw new UsptoParseError(`document failed schema validation: ${result.error.message}`, {
      doc: fileHint,
    });
  }
  return candidate;
}
