/**
 * The shapes a graph's rules document is edited through: SHACL describing SHACL, as W3C's
 * SHACL-SHACL does, so `@kanzo-tech/metadata-form` draws the editor and rudof validates the rules
 * before they run.
 *
 * **A constrained subset of SHACL-SHACL, not the whole of it.** The W3C shapes-for-shapes graph is
 * written to validate a shapes graph, not to be filled in: every SHACL Core term at once, unlabelled,
 * and alternatives (`sh:or` over node kinds and list forms) that draw as a wall of empty branches. This
 * is the part of it a rule is written with — a node shape that targets one type of the graph, and
 * property shapes on it with the Core value-type, cardinality, range and string constraints — named
 * for a reader, and with the graph's own types and properties as the choices. A rules document written
 * elsewhere with more of SHACL Core still validates: rudof's SQL engine reads all of it, and this form
 * only draws the part it knows.
 */

/** The graph's own terms: what a rule may target, and what it may check. */
export interface RuleVocabulary {
  classes: readonly string[];
  properties: readonly string[];
}

const PREFIXES = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
`;

/** A rules document with nothing in it yet: the prefixes a serialisation of it keeps. */
export const EMPTY_RULES = PREFIXES;

/** `sh:in` over the given IRIs, or nothing when the graph names none. */
const oneOf = (iris: readonly string[]) => (iris.length ? `sh:in ( ${iris.map((iri) => `<${iri}>`).join(" ")} ) ;` : "");

/** The form's own shapes, which only the form loads: they are never part of a rules document. */
const FORM = "urn:keasy:rules-form#";

/** The node shape a rule is, and the property shape each of its checks is. */
export const RULE_SHAPE = `${FORM}Rule`;

export function ruleShapes({ classes, properties }: RuleVocabulary): string {
  return `${PREFIXES}@prefix form: <${FORM}> .

form:Rule a sh:NodeShape ;
  sh:targetClass sh:NodeShape ;
  sh:property form:name , form:target , form:checks , form:severity , form:message , form:deactivated .

form:name sh:path sh:name ; sh:name "Name" ; sh:order 0 ;
  sh:description "What the rule is called where its findings are listed." ;
  sh:datatype xsd:string ; sh:maxCount 1 .

form:target sh:path sh:targetClass ; sh:name "Applies to" ; sh:order 1 ;
  sh:description "The type whose every vertex the rule checks." ;
  sh:nodeKind sh:IRI ; ${oneOf(classes)} sh:minCount 1 ; sh:maxCount 1 .

form:checks sh:path sh:property ; sh:name "Checks" ; sh:order 2 ;
  sh:description "Each check is one property and what its values must be." ;
  sh:node form:Check ; sh:minCount 1 .

form:severity sh:path sh:severity ; sh:name "Severity" ; sh:order 3 ;
  sh:description "How bad a vertex that fails it is. A violation unless said otherwise." ;
  sh:in ( sh:Violation sh:Warning sh:Info ) ; sh:maxCount 1 .

form:message sh:path sh:message ; sh:name "Message" ; sh:order 4 ;
  sh:description "What a finding says, in place of the engine's own wording." ;
  sh:datatype xsd:string ; sh:maxCount 1 .

form:deactivated sh:path sh:deactivated ; sh:name "Switched off" ; sh:order 5 ;
  sh:description "A switched-off rule is kept and checks nothing." ;
  sh:datatype xsd:boolean ; sh:maxCount 1 .

form:Check a sh:NodeShape ;
  sh:property
    [ sh:path sh:path ; sh:name "Property" ; sh:order 0 ; sh:nodeKind sh:IRI ; ${oneOf(properties)}
      sh:minCount 1 ; sh:maxCount 1 ] ,
    [ sh:path sh:minCount ; sh:name "At least" ; sh:order 1 ; sh:description "How many values a vertex must have." ;
      sh:datatype xsd:integer ; sh:minInclusive 0 ; sh:maxCount 1 ] ,
    [ sh:path sh:maxCount ; sh:name "At most" ; sh:order 2 ; sh:description "How many values a vertex may have." ;
      sh:datatype xsd:integer ; sh:minInclusive 0 ; sh:maxCount 1 ] ,
    [ sh:path sh:datatype ; sh:name "Datatype" ; sh:order 3 ;
      sh:in ( xsd:string xsd:integer xsd:decimal xsd:double xsd:boolean xsd:date xsd:dateTime xsd:time ) ;
      sh:maxCount 1 ] ,
    [ sh:path sh:nodeKind ; sh:name "Kind of value" ; sh:order 4 ;
      sh:in ( sh:IRI sh:Literal sh:BlankNode sh:BlankNodeOrIRI sh:BlankNodeOrLiteral sh:IRIOrLiteral ) ;
      sh:maxCount 1 ] ,
    [ sh:path sh:minInclusive ; sh:name "Minimum" ; sh:order 5 ; sh:datatype xsd:decimal ; sh:maxCount 1 ] ,
    [ sh:path sh:maxInclusive ; sh:name "Maximum" ; sh:order 6 ; sh:datatype xsd:decimal ; sh:maxCount 1 ] ,
    [ sh:path sh:minLength ; sh:name "Shortest" ; sh:order 7 ; sh:datatype xsd:integer ; sh:minInclusive 0 ;
      sh:maxCount 1 ] ,
    [ sh:path sh:maxLength ; sh:name "Longest" ; sh:order 8 ; sh:datatype xsd:integer ; sh:minInclusive 0 ;
      sh:maxCount 1 ] ,
    [ sh:path sh:pattern ; sh:name "Pattern" ; sh:order 9 ; sh:description "A regular expression every value matches." ;
      sh:datatype xsd:string ; sh:maxCount 1 ] ,
    [ sh:path sh:message ; sh:name "Message" ; sh:order 10 ; sh:datatype xsd:string ; sh:maxCount 1 ] .
`;
}
