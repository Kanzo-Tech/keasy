/// Well-known RDF vocabulary IRIs shared across the graph domain.

// RDF / RDFS
pub const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
pub const RDFS_LABEL: &str = "http://www.w3.org/2000/01/rdf-schema#label";
pub const RDFS_COMMENT: &str = "http://www.w3.org/2000/01/rdf-schema#comment";

// DCAT
pub const DCAT_CATALOG: &str = "http://www.w3.org/ns/dcat#Catalog";
pub const DCAT_DATASET: &str = "http://www.w3.org/ns/dcat#Dataset";
pub const DCAT_DISTRIBUTION: &str = "http://www.w3.org/ns/dcat#Distribution";
pub const DCAT_DATASET_PROP: &str = "http://www.w3.org/ns/dcat#dataset";
pub const DCAT_DISTRIBUTION_PROP: &str = "http://www.w3.org/ns/dcat#distribution";
pub const DCAT_ACCESS_URL: &str = "http://www.w3.org/ns/dcat#accessURL";
pub const DCAT_MEDIA_TYPE: &str = "http://www.w3.org/ns/dcat#mediaType";
pub const DCAT_CONTACT_POINT: &str = "http://www.w3.org/ns/dcat#contactPoint";
pub const DCAT_KEYWORD: &str = "http://www.w3.org/ns/dcat#keyword";

// Dublin Core
pub const DCT_TITLE: &str = "http://purl.org/dc/terms/title";
pub const DCT_DESCRIPTION: &str = "http://purl.org/dc/terms/description";
pub const DCT_ISSUED: &str = "http://purl.org/dc/terms/issued";
pub const DCT_PUBLISHER: &str = "http://purl.org/dc/terms/publisher";
pub const DCT_LICENSE: &str = "http://purl.org/dc/terms/license";
pub const DCT_SOURCE: &str = "http://purl.org/dc/terms/source";
pub const DCT_CONFORMS_TO: &str = "http://purl.org/dc/terms/conformsTo";
pub const DCT_LANGUAGE: &str = "http://purl.org/dc/terms/language";

// FOAF
pub const FOAF_AGENT: &str = "http://xmlns.com/foaf/0.1/Agent";
pub const FOAF_NAME: &str = "http://xmlns.com/foaf/0.1/name";
pub const FOAF_HOMEPAGE: &str = "http://xmlns.com/foaf/0.1/homepage";

// vCard
pub const VCARD_KIND: &str = "http://www.w3.org/2006/vcard/ns#Kind";
pub const VCARD_HAS_EMAIL: &str = "http://www.w3.org/2006/vcard/ns#hasEmail";

// XSD datatypes
pub const XSD_DATETIME: &str = "http://www.w3.org/2001/XMLSchema#dateTime";

// Keasy internal vocabulary
pub const KEASY_FIELD: &str = "urn:keasy:vocab#Field";
pub const KEASY_FIELD_PROP: &str = "urn:keasy:vocab#field";
