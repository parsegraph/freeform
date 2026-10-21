import { Alignment, Direction, DirectionNode, Fit } from "parsegraph";

const XML_SPACE = "[\\x20\\t\\r\\n]";
const DECLARATION = new RegExp(
  `^<\\?xml${XML_SPACE}+version${XML_SPACE}*=${XML_SPACE}*(["'])1\\.0\\1` +
    `(?:${XML_SPACE}+encoding${XML_SPACE}*=${XML_SPACE}*(["'])([A-Za-z][A-Za-z0-9._-]*)\\2)?` +
    `(?:${XML_SPACE}+standalone${XML_SPACE}*=${XML_SPACE}*(["'])(yes|no)\\4)?${XML_SPACE}*\\?>$`
);
const DOCTYPE = new RegExp(
  `^<!DOCTYPE${XML_SPACE}+([^\\x20\\t\\r\\n>]+)` +
    `(?:${XML_SPACE}+SYSTEM${XML_SPACE}+(?:"[^"]*"|'[^']*')|` +
    `${XML_SPACE}+PUBLIC${XML_SPACE}+(?:"[^"]*"|'[^']*')${XML_SPACE}+(?:"[^"]*"|'[^']*'))?${XML_SPACE}*>$`
);
const PARSER_ERROR_NS = "http://www.mozilla.org/newlayout/xml/parsererror.xml";

function fail(message) {
  throw new Error(`XML: ${message}`);
}

function declarationAttributes(raw) {
  const match = DECLARATION.exec(raw);
  if (!match)
    fail(
      "Only an XML 1.0 declaration with optional encoding and standalone is supported."
    );
  return [
    ["version", "1.0"],
    ...(match[3] ? [["encoding", match[3]]] : []),
    ...(match[5] ? [["standalone", match[5]]] : []),
  ];
}

function validateDoctype(raw) {
  // Do not feed DTDs to a parser. External identifiers are opaque data only.
  let quote = null;
  for (const char of raw) {
    const code = char.codePointAt(0);
    if (
      !(
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      )
    )
      fail("Invalid character in DOCTYPE.");
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[")
      fail("Custom DTD subsets and entity declarations are not supported.");
  }
  const match = DOCTYPE.exec(raw);
  if (!match) fail("Malformed or unsupported DOCTYPE declaration.");
  const external = raw.slice(9).trimStart().slice(match[1].length).trim();
  if (external.startsWith("PUBLIC")) {
    const publicId = external.match(
      /^PUBLIC[\x20\t\r\n]+(?:"([^"]*)"|'([^']*)')/
    );
    if (
      !/^[\x20\r\na-zA-Z0-9\-'()+,./:=?;!*#@$_%]*$/.test(
        publicId[1] ?? publicId[2]
      )
    ) {
      fail("Invalid public identifier in DOCTYPE.");
    }
  }
  return raw;
}

function parseSource(input) {
  if (typeof input !== "string") fail("Expected XML text.");
  const source = input.replace(/^\uFEFF/, "");
  const declaration = source.match(/^<\?xml[\x20\t\r\n][\s\S]*?\?>/)?.[0];
  if (declaration) declarationAttributes(declaration);
  let marker = "freeform-doctype";
  while (source.includes(marker)) marker += "-x";
  let doctype = null;
  let scan = 0;
  let rewritten = "";
  while (scan < source.length) {
    const start = source.indexOf("<", scan);
    if (start < 0) {
      rewritten += source.slice(scan);
      break;
    }
    rewritten += source.slice(scan, start);
    const terminator = source.startsWith("<!--", start)
      ? "-->"
      : source.startsWith("<![CDATA[", start)
      ? "]]>"
      : source.startsWith("<?", start)
      ? "?>"
      : null;
    if (terminator) {
      const end = source.indexOf(terminator, start + 2);
      if (end < 0)
        fail("Unterminated comment, CDATA section, or processing instruction.");
      scan = end + terminator.length;
      rewritten += source.slice(start, scan);
      continue;
    }
    if (source.startsWith("<!DOCTYPE", start)) {
      if (doctype !== null) fail("A document may contain only one DOCTYPE.");
      let end = start + 9;
      let quote = null;
      for (; end < source.length; end++) {
        const char = source[end];
        if (quote) {
          if (char === quote) quote = null;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === "[")
          fail("Custom DTD subsets and entity declarations are not supported.");
        else if (char === ">") break;
      }
      if (end === source.length) fail("Unterminated DOCTYPE.");
      doctype = validateDoctype(source.slice(start, end + 1));
      rewritten += `<?${marker}?>`;
      scan = end + 1;
      continue;
    }
    rewritten += "<";
    scan = start + 1;
  }
  const document = new DOMParser().parseFromString(
    rewritten,
    "application/xml"
  );
  const error = document.getElementsByTagNameNS(
    PARSER_ERROR_NS,
    "parsererror"
  )[0];
  if (error || !document.documentElement) {
    fail(error?.textContent?.trim() || "The document is not well-formed XML.");
  }
  if (doctype !== null) {
    const nodes = Array.from(document.childNodes);
    const index = nodes.findIndex(
      (node) => node.nodeType === 7 && node.target === marker
    );
    if (index < 0 || index > nodes.indexOf(document.documentElement)) {
      fail(
        "DOCTYPE must occur before the document element, outside its contents."
      );
    }
    // Validate the name without resolving or applying any declaration.
    const name = DOCTYPE.exec(doctype)[1];
    const check = new DOMParser().parseFromString(
      `<${name}/>`,
      "application/xml"
    );
    // A prefixed name can require declarations on the actual root; check its
    // local name syntactically instead, then let the document check namespaces.
    if (
      check.getElementsByTagNameNS(PARSER_ERROR_NS, "parsererror").length &&
      name !== document.documentElement.nodeName
    )
      fail("Invalid DOCTYPE name.");
  }
  return { document, declaration, doctype, marker };
}

function dataNode(kind, value) {
  const node = new DirectionNode(kind);
  node.connect(Direction.DOWNWARD, new DirectionNode(value));
  return node;
}

function addAttributes(node, attributes) {
  let previous;
  for (const [name, value] of attributes) {
    const attribute = new DirectionNode(`@${name}`);
    if (previous) previous.connect(Direction.DOWNWARD, attribute);
    else {
      node.connect(Direction.INWARD, attribute);
      attribute.paintGroups().crease();
    }
    attribute.connect(Direction.FORWARD, new DirectionNode(value));
    attribute.siblings().pull(Direction.FORWARD);
    previous = attribute;
  }
}

function appendChild(previous, node, first = false) {
  const bud = new DirectionNode();
  const direction = first ? Direction.DOWNWARD : Direction.FORWARD;
  previous.connect(direction, bud);
  if (first) {
    previous.neighbors().align(direction, Alignment.CENTER);
    previous.setNodeFit(Fit.EXACT);
  }
  bud.connect(Direction.DOWNWARD, node);
  bud.neighbors().align(Direction.DOWNWARD, Alignment.CENTER);
  bud.setNodeFit(Fit.EXACT);
  bud.siblings().pull(Direction.DOWNWARD);
  return bud;
}

/** Attributes inward; a horizontal multislot has forward buds, downward children. */
export function graphXml(input) {
  const parsed = parseSource(input);
  const root = new DirectionNode("#document");
  const jobs = [
    { parent: root, children: Array.from(parsed.document.childNodes) },
  ];
  if (parsed.declaration) {
    const declaration = new DirectionNode("#xml");
    addAttributes(declaration, declarationAttributes(parsed.declaration));
    jobs[0].previous = appendChild(root, declaration, true);
  }
  while (jobs.length) {
    const { parent, children, previous: firstPrevious } = jobs.pop();
    let previous = firstPrevious || parent;
    for (const child of children) {
      let node;
      switch (child.nodeType) {
        case 1:
          node = new DirectionNode(`<${child.nodeName}>`);
          addAttributes(
            node,
            Array.from(child.attributes, (attribute) => [
              attribute.name,
              attribute.value,
            ])
          );
          if (child.childNodes.length)
            jobs.push({ parent: node, children: Array.from(child.childNodes) });
          break;
        case 3:
          node = dataNode("#text", child.data);
          break;
        case 4:
          node = dataNode("#cdata", child.data);
          break;
        case 8:
          node = dataNode("#comment", child.data);
          break;
        case 7:
          node =
            child.target === parsed.marker
              ? dataNode("#doctype", parsed.doctype)
              : dataNode(`?${child.target}`, child.data);
          break;
        default:
          fail(`Unsupported XML node type ${child.nodeType}.`);
      }
      previous = appendChild(previous, node, previous === parent);
    }
  }
  return root;
}

const DIRECTIONS = [
  Direction.INWARD,
  Direction.OUTWARD,
  Direction.UPWARD,
  Direction.DOWNWARD,
  Direction.BACKWARD,
  Direction.FORWARD,
];
function child(node, direction) {
  return node.neighbors().hasChild(direction)
    ? node.neighbors().nodeAt(direction)
    : null;
}
function checkChildren(node, allowed) {
  for (const direction of DIRECTIONS) {
    if (child(node, direction) && !allowed.includes(direction)) {
      fail(
        `Unexpected connection on ${String(
          node.value()
        )}; this graph no longer follows the XML mapping.`
      );
    }
  }
}
function valueOf(node) {
  if (node.value() === undefined) return ""; // The text editor clears a value this way.
  if (typeof node.value() !== "string")
    fail("XML names and values must be text.");
  return node.value();
}
function dataOf(node) {
  checkChildren(node, [Direction.DOWNWARD]);
  const data = child(node, Direction.DOWNWARD);
  if (!data) fail(`${valueOf(node)} needs a value below it.`);
  checkChildren(data, []);
  return valueOf(data);
}
function attributesOf(node) {
  const attributes = [];
  const names = new Set();
  let attribute = child(node, Direction.INWARD);
  while (attribute) {
    checkChildren(attribute, [Direction.DOWNWARD, Direction.FORWARD]);
    const label = valueOf(attribute);
    if (!label.startsWith("@") || label.length < 2)
      fail("Attribute names must start with @.");
    const name = label.slice(1);
    if (names.has(name)) fail(`Duplicate attribute ${name}.`);
    names.add(name);
    const value = child(attribute, Direction.FORWARD);
    if (!value) fail(`Attribute ${name} needs a value to its right.`);
    checkChildren(value, []);
    attributes.push([name, valueOf(value)]);
    attribute = child(attribute, Direction.DOWNWARD);
  }
  return attributes;
}
function escaped(value, attribute = false) {
  const text = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;");
  return attribute
    ? text
        .replace(/"/g, "&quot;")
        .replace(/\t/g, "&#9;")
        .replace(/\n/g, "&#10;")
    : text;
}

function serializeGraph(root) {
  if (root.value() !== "#document")
    fail("Export requires an imported XML graph with a #document root.");
  checkChildren(root, [Direction.DOWNWARD]);
  const output = [];
  const jobs = [{ bud: child(root, Direction.DOWNWARD), documentLevel: true }];
  while (jobs.length) {
    const job = jobs.pop();
    if (job.close) {
      output.push(job.close);
      continue;
    }
    const { bud, documentLevel } = job;
    if (!bud) continue;
    checkChildren(bud, [Direction.DOWNWARD, Direction.FORWARD]);
    if (valueOf(bud) !== "") fail("Child list buds must be empty.");
    const node = child(bud, Direction.DOWNWARD);
    if (!node) fail("Each child list bud needs an XML node below it.");
    const sibling = child(bud, Direction.FORWARD);
    if (sibling) jobs.push({ bud: sibling, documentLevel });
    const label = valueOf(node);
    if (label.startsWith("<") && label.endsWith(">")) {
      checkChildren(node, [Direction.INWARD, Direction.DOWNWARD]);
      const name = label.slice(1, -1);
      const attributes = attributesOf(node)
        .map(([key, value]) => ` ${key}="${escaped(value, true)}"`)
        .join("");
      const first = child(node, Direction.DOWNWARD);
      output.push(`<${name}${attributes}${first ? ">" : "/>"}`);
      if (first) {
        jobs.push({ close: `</${name}>` });
        jobs.push({ bud: first, documentLevel: false });
      }
    } else if (label === "#xml") {
      if (!documentLevel || output.length)
        fail("The XML declaration must be first in the document.");
      checkChildren(node, [Direction.INWARD]);
      const attributes = attributesOf(node)
        .map(
          ([key, value]) =>
            ` ${key}="${escaped(key === "encoding" ? "UTF-8" : value, true)}"`
        )
        .join("");
      const declaration = `<?xml${attributes}?>`;
      declarationAttributes(declaration);
      output.push(declaration);
    } else if (label === "#doctype") {
      if (!documentLevel) fail("DOCTYPE belongs outside the document element.");
      output.push(validateDoctype(dataOf(node)));
    } else if (label === "#text") {
      output.push(escaped(dataOf(node)));
    } else if (label === "#comment") {
      const data = dataOf(node);
      if (data.includes("--") || data.endsWith("-"))
        fail("Comments cannot contain -- or end with -.");
      output.push(`<!--${data}-->`);
    } else if (label === "#cdata") {
      const data = dataOf(node);
      if (documentLevel || data.includes("]]>") || data.includes("\r")) {
        fail(
          "CDATA must be inside an element and cannot contain ]]> or a carriage return; use #text for that content."
        );
      }
      output.push(`<![CDATA[${data}]]>`);
    } else if (label.startsWith("?")) {
      const data = dataOf(node);
      if (data.includes("?>"))
        fail("Processing instruction data cannot contain ?>.");
      output.push(`<?${label.slice(1)}${data ? ` ${data}` : ""}?>`);
    } else fail(`Unknown XML graph node ${label}.`);
  }
  const xml = output.join("");
  // Validate names, namespaces, characters, and document structure after edits.
  return { xml, document: parseSource(xml).document };
}

export function exportGraphToXml(root) {
  return serializeGraph(root).xml;
}

export function exportGraphToSvg(root) {
  const { xml, document } = serializeGraph(root);
  const element = document.documentElement;
  if (
    element.localName !== "svg" ||
    element.namespaceURI !== "http://www.w3.org/2000/svg"
  ) {
    fail(
      "SVG export requires an svg document element in the http://www.w3.org/2000/svg namespace."
    );
  }
  return xml;
}

/** Decode file bytes rather than silently replacing non-UTF-8 XML characters. */
export async function readXmlFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let detected;
  if (
    (bytes[0] === 0xff &&
      bytes[1] === 0xfe &&
      bytes[2] === 0 &&
      bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
  ) {
    fail("UTF-32 input is not supported; convert it to UTF-8 or UTF-16.");
  }
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0x3c && bytes[1] === 0)
  )
    detected = "utf-16le";
  else if (
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0 && bytes[1] === 0x3c)
  )
    detected = "utf-16be";
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    detected = "utf-8";
  try {
    const header = detected
      ? new TextDecoder(detected, { fatal: true }).decode(bytes)
      : Array.from(
          bytes.subarray(
            0,
            bytes.indexOf(0x3e) < 0 ? bytes.length : bytes.indexOf(0x3e) + 1
          ),
          (byte) => String.fromCharCode(byte)
        ).join("");
    const declared =
      header.match(
        /^\uFEFF?<\?xml[^?]*\bencoding\s*=\s*["']([^"']+)["']/
      )?.[1] ??
      header.match(/^<\?xml[^?]*\bencoding\s*=\s*["']([^"']+)["']/)?.[1];
    const encoding = detected || declared || "utf-8";
    if (
      detected &&
      declared &&
      !(detected.startsWith("utf-16") && declared.toLowerCase() === "utf-16") &&
      new TextDecoder(declared).encoding !== new TextDecoder(detected).encoding
    ) {
      fail("The encoding declaration does not match the file's byte order.");
    }
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (error) {
    if (error.message.startsWith("XML:")) throw error;
    fail(
      `Could not decode the XML file (${error.message}). Check its encoding declaration.`
    );
  }
}
