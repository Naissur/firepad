firepad.MonacoAdapter = (function () {
  'use strict';

  var TextOperation = firepad.TextOperation;
  var WrappedOperation = firepad.WrappedOperation;
  var Cursor = firepad.Cursor;

  function MonacoAdapter (editor) {
    this.editor = editor;
    this.otherCursorDecorationsIds = {};
    this.otherCursorWidgets = {};

    this.editor.model.setEOL(monaco.editor.EndOfLineSequence.LF);

    bind(this, 'handleModelBulkEvents');
    bind(this, 'onAttributesChange');
    bind(this, 'onCursorActivity');
    bind(this, 'onFocus');
    bind(this, 'onBlur');
    bind(this, 'updateOtherCursorsWidgetsHeight');
    this.grabDocumentState();

    this.bulkListener = this.editor.model.addBulkListener(this.handleModelBulkEvents);
    this.cursorListener = this.editor.onDidChangeCursorSelection(this.onCursorActivity);
    this.focusListener = this.editor.onDidFocusEditorText(this.onFocus);
    this.blurListener = this.editor.onDidBlurEditor(this.onBlur);
    this.widgetsUpdateListener = this.editor.onDidChangeConfiguration(this.updateOtherCursorsWidgetsHeight);
  }

  // Removes all event listeners from the CodeMirror instance.
  MonacoAdapter.prototype.detach = function () {
    // ?
    if (this.bulkListener) { this.bulkListener.dispose(); }
    if (this.cursorListener) { this.cursorListener.dispose(); }
    if (this.focusListener) { this.focusListener.dispose(); }
    if (this.blurListener) { this.blurListener.dispose(); }
    if (this.widgetsUpdateListener) { this.widgetsUpdateListener.dispose(); }
  };

  MonacoAdapter.prototype.trigger = function (event) {
    var args = Array.prototype.slice.call(arguments, 1);
    var action = this.callbacks && this.callbacks[event];
    if (action) { action.apply(this, args); }
  };

  MonacoAdapter.prototype.registerCallbacks = function (cb) {
    this.callbacks = cb;
  };



  MonacoAdapter.prototype.grabDocumentState = function () {
    this.lastDocLines = this.editor.model.getLinesContent();
  }

  MonacoAdapter.prototype.handleModelBulkEvents = function (events) {
    if (this.ignoreChanges) { return; }

    var contentChanges = [];

    for (var i = 0; i < events.length; i++) {
      var event = events[i];

      if(event.getType() === 'contentChanged2') {
        contentChanges.push(event.getData());
      }
    }


    if (contentChanges.length === 0) { return; }

    var pair = getOperationFromMonacoChanges(contentChanges, this.editor, this.lastDocLines, this.getValue());
    var self = this;
    self.grabDocumentState();

    setTimeout(function() {
      self.trigger('change', pair[0], pair[1]);
      self.grabDocumentState();
    }, 1);
  };

  MonacoAdapter.prototype.onCursorActivity = function () {
    var self = this;
    setTimeout(function() {
      self.trigger('cursorActivity');
    }, 1);
  }

  MonacoAdapter.prototype.onFocus = function () {
    this.trigger('focus');
  };

  MonacoAdapter.prototype.onBlur = function () {
    if (this.editor.getSelection().isEmpty()) {
      this.trigger('blur');
    }
  };

  MonacoAdapter.prototype.getValue = function () {
    return this.editor.model.getValue();
  };

  MonacoAdapter.prototype.getCursor = function () {
    var editor = this.editor;

    var selection = editor.getSelection();
    var startOffset = editor.model.getOffsetAt({ lineNumber: selection.positionLineNumber, column: selection.positionColumn });
    var endOffset = editor.model.getOffsetAt({ lineNumber: selection.selectionStartLineNumber, column: selection.selectionStartColumn });

    return new Cursor(startOffset, endOffset);
  };

  MonacoAdapter.prototype.setCursor = function (cursor) {
    var editor = this.editor;

    var start = editor.model.getPositionAt(cursor.position);
    var end = editor.model.getPositionAt(cursor.selectionEnd);

    editor.setSelection({
      positionLineNumber: start.lineNumber,
      positionColumn: start.column,
      selectionStartLineNumber: end.lineNumber,
      selectionStartColumn: end.column
    });
  };

  MonacoAdapter.prototype.setOtherCursor = function (cursor, color, clientId) {
    var editor = this.editor;

    var startPosition = editor.model.getPositionAt(cursor.position);
    var endPosition = editor.model.getPositionAt(cursor.selectionEnd);

    var self = this;
    if (cursor.position === cursor.selectionEnd) {
      var fontSize = editor.getConfiguration().fontInfo.lineHeight + 'px';

      var node = document.createElement('span');
      node.className = 'other-client';
      node.innerHTML = '&nbsp;';
      node.style.borderLeftWidth = '2px';
      node.style.borderLeftStyle = 'solid';
      node.style.borderLeftColor = color;
      // node.style.marginLeft = node.style.marginRight = '-1px';
      node.style.height = fontSize;
      node.style.pointerEvents = 'none';
      node.setAttribute('data-clientid', clientId);

      var widget = {
        allowEditorOverflow: false,
        getId: function() { return clientId; },
        getDomNode: function() { return node; },
        getPosition: function() { return { position: startPosition, preference: [ monaco.editor.ContentWidgetPositionPreference.EXACT ] } }
      }

      editor.addContentWidget(widget);
      this.otherCursorWidgets[clientId] = widget;
    } else {
      editor.changeDecorations(function(changeAccessor) {
        var selectionClassName = 'selection-' + color.replace('#', '');
        var transparency = 0.4;
        var rule = '.' + selectionClassName + ' {' +
          ' background: ' + hex2rgb(color) + ';\n' +
          ' background: ' + hex2rgb(color, transparency) + ';' +
        '}';
        self.addStyleRule(rule);

        var decorationId = changeAccessor.addDecoration({
          startLineNumber: startPosition.lineNumber,
          startColumn: startPosition.column,
          endLineNumber: endPosition.lineNumber,
          endColumn: endPosition.column
        }, {
          inlineClassName: 'other-client-selection ' + selectionClassName
        });

        self.otherCursorDecorationsIds[clientId] = decorationId;
      });


    }

    return {
      clear: function() {
        editor.changeDecorations(function(changeAccessor) {
          if (self && self.otherCursorDecorationsIds[clientId]) {
            changeAccessor.removeDecoration(self.otherCursorDecorationsIds[clientId]);
            delete self.otherCursorDecorationsIds[clientId];
          }

          if (self && self.otherCursorWidgets[clientId]) {
            editor.removeContentWidget(self.otherCursorWidgets[clientId]);
            delete self.otherCursorWidgets[clientId];
          }
        });
      }
    };
  };


  MonacoAdapter.prototype.updateOtherCursorsWidgetsHeight = function(newConfiguration) {
    var fontSize = this.editor.getConfiguration().fontInfo.lineHeight + 'px';

    for(var widgetId in this.otherCursorWidgets) {
      var widget = this.otherCursorWidgets[widgetId];
      var node = widget.getDomNode();
      node.style.height = fontSize;
    }
  }

  MonacoAdapter.prototype.addStyleRule = function(css) {
    if (typeof document === "undefined" || document === null) {
      return;
    }
    if (!this.addedStyleRules) {
      this.addedStyleRules = {};
      var styleElement = document.createElement('style');
      document.documentElement.getElementsByTagName('head')[0].appendChild(styleElement);
      this.addedStyleSheet = styleElement.sheet;
    }
    if (this.addedStyleRules[css]) {
      return;
    }
    this.addedStyleRules[css] = true;
    return this.addedStyleSheet.insertRule(css, 0);
  };


  MonacoAdapter.prototype.applyOperation = function (operation) {
    this.ignoreChanges = true;

    var editor = this.editor;

    var ops = operation.ops;
    var index = 0;

    for (var i = 0, l = ops.length; i < l; i++) {
      var op = ops[i];
      if (op.isRetain()) {
        index += op.chars;
      } else if (op.isInsert()) {
        var pos = editor.model.getPositionAt(index);
        var range = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);

        editor.model.applyEdits([{
          identifier: 'MONACOADAPTER',
          range: range,
          text: op.text,
          forceMoveMarkers: true
        }]);
        index += op.text.length;
      } else if (op.isDelete()) {
        var start = editor.model.getPositionAt(index);
        var end = editor.model.getPositionAt(index + op.chars);
        var range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);

        editor.model.applyEdits([{
          identifier: 'MONACOADAPTER',
          range: range,
          text: null
        }]);
      }
    }

    this.ignoreChanges = false;
    this.grabDocumentState();
  };

  MonacoAdapter.prototype.registerUndo = function (undoFn) {
    this.editor.model.undo = undoFn;
  };

  MonacoAdapter.prototype.registerRedo = function (redoFn) {
    this.editor.model.redo = redoFn;
  };

  MonacoAdapter.prototype.invertOperation = function(operation) {
    return operation.invert(this.getValue());
  };

  function getOperationFromMonacoChanges (changes, editor, lastDocLines, currentDocValue) {
    var lastDocValue = lastDocLines.join('\n');

    var docEndLength = currentDocValue.length;
    var operation    = new TextOperation().retain(docEndLength);
    var inverse      = new TextOperation().retain(docEndLength);


    for (var i = changes.length - 1; i >= 0; i--) {
      var change = changes[i];

      var range = change.range;

      var startOffset = getOffsetAt(lastDocLines, range.startLineNumber, range.startColumn);
      var endOffset = getOffsetAt(lastDocLines, range.endLineNumber, range.endColumn);

      var deletedText = lastDocValue.substring(startOffset, endOffset);
      var insertedText = change.text;


      var restLength = docEndLength - startOffset - insertedText.length;

      operation = new firepad.TextOperation()
                             .retain(startOffset)
                             ['delete'](deletedText)
                             .insert(insertedText)
                             .retain(restLength)
                             .compose(operation);

      inverse = inverse.compose(new firepad.TextOperation()
                           .retain(startOffset)
                           ['delete'](insertedText)
                           .insert(deletedText)
                           .retain(restLength));

      docEndLength = docEndLength + deletedText.length - insertedText.length;
    }

    return [ operation, inverse ];
  };


  function bind (obj, method) {
    var fn = obj[method];
    obj[method] = function () {
      fn.apply(obj, arguments);
    };
  }

  function exists (val) {
    return val !== null && val !== undefined;
  }

  function getOffsetAt(lines, lineNr, colNr) {
    var sum = 0;
    for (var i = 0; i < lineNr - 1; i++) {
      sum += lines[i].length;
      sum += 1;
    }

    sum += colNr - 1;
    return sum;
  }


  function hex2rgb (hex, transparency) {
    if (typeof hex !== 'string') {
      throw new TypeError('Expected a string');
    }
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    var num = parseInt(hex, 16);
    var rgb = [num >> 16, num >> 8 & 255, num & 255];
    var type = 'rgb';
    if (exists(transparency)) {
      type = 'rgba';
      rgb.push(transparency);
    }
    // rgb(r, g, b) or rgba(r, g, b, t)
    return type + '(' + rgb.join(',') + ')';
  }


  return MonacoAdapter;
}());
