function id(x: TemplateStringsArray) {
  return x;
}

function templateObjectFactory() {
  return id`hello world`;
}

export default templateObjectFactory() === templateObjectFactory(); // true in TS 2.6
