/// A single RDF triple with all components as owned strings.
pub struct RdfTriple {
    pub subject: String,
    pub predicate: String,
    pub object: String,
    pub object_datatype: Option<String>,
    pub object_lang: Option<String>,
}
