// The frontend client (imported by contract.test.ts) is written for the browser, whose
// global BodyInit type Node does not declare.
type BodyInit = string | Blob;
