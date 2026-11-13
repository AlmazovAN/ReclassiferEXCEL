function createFolderV4Cascade({projectRow, buildContext, event, object, element, failure, cause, path, review}) {
  function evaluateRow(facts, context) {
    const assessment = event(projectRow(facts));
    const objects = object(assessment,context);
    const selectedElement = element(objects,context);
    const selectedFailure = failure(selectedElement,objects,context);
    const selectedCause = cause(selectedFailure,assessment,context);
    const pathReview = path(assessment,objects,selectedElement,selectedFailure,selectedCause,context);
    return review(assessment,objects,selectedElement,selectedFailure,selectedCause,pathReview);
  }

  return Object.freeze({buildContext,evaluateRow});
}
