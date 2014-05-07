module Unicode from "Unicode.js";

var identifierEscape = /\\u([0-9a-fA-F]{4})/g,
    newlineSequence = /\r\n?|[\n\u2028\u2029]/g;

// === Reserved Words ===
var reservedWord = new RegExp("^(?:" +
    "break|case|catch|class|const|continue|debugger|default|delete|do|" +
    "else|enum|export|extends|false|finally|for|function|if|import|in|" +
    "instanceof|new|null|return|super|switch|this|throw|true|try|typeof|" +
    "var|void|while|with" +
")$");

// === Punctuators ===
var multiCharPunctuator = new RegExp("^(?:" +
    "--|[+]{2}|" +
    "&&|[|]{2}|" +
    "<<=?|" +
    ">>>?=?|" +
    "[!=]==|" +
    "=>|" +
    "[\.]{2,3}|" +
    "[-+&|<>!=*&\^%\/]=" +
")$");

// === Miscellaneous Patterns ===
var octalEscape = /^(?:[0-3][0-7]{0,2}|[4-7][0-7]?)/,
    blockCommentPattern = /\r\n?|[\n\u2028\u2029]|\*\//g,
    hexChar = /[0-9a-f]/i;

// === Character type lookup table ===
function makeCharTable() {

    var table = [],
        i;
    
    for (i = 0; i < 128; ++i) table[i] = "";
    for (i = 65; i <= 90; ++i) table[i] = "identifier";
    for (i = 97; i <= 122; ++i) table[i] = "identifier";
    
    add("whitespace", "\t\v\f ");
    add("newline", "\r\n");
    add("decimal-digit", "123456789");
    add("punctuator-char", "{[]();,?:");
    add("punctuator", "<>+-*%&|^!~=");
    add("dot", ".");
    add("slash", "/");
    add("rbrace", "}");
    add("zero", "0");
    add("string", "'\"");
    add("template", "`");
    add("identifier", "$_\\");
    
    return table;
    
    function add(type, string) {
    
        string.split("").forEach(c => table[c.charCodeAt(0)] = type);
    }
}

var charTable = makeCharTable();

// Performs a binary search on an array
function binarySearch(array, val) {

    var right = array.length - 1,
        left = 0,
        mid,
        test;
    
    while (left <= right) {
        
        mid = (left + right) >> 1;
        test = array[mid];
        
        if (val === test)
            return mid;
        
        if (val < test) right = mid - 1;
        else left = mid + 1;
    }
    
    return left;
}

// Returns true if the character is a valid identifier part
function isIdentifierPartAscii(c) {

    return  c > 64 && c < 91 || 
            c > 96 && c < 123 ||
            c > 47 && c < 58 ||
            c === 36 ||
            c === 95;
}

// Returns true if the specified character is a newline
function isNewlineChar(c) {

    switch (c) {
    
        case "\r":
        case "\n":
        case "\u2028":
        case "\u2029":
            return true;
    }
    
    return false;
}

// Returns true if the specified character can exist in a non-starting position
function isPunctuatorNext(c) {

    switch (c) {
    
        case "+":
        case "-":
        case "&":
        case "|":
        case "<":
        case ">":
        case "=":
        case ".":
            return true;
    }
    
    return false;
}

export class Scanner {

    constructor(input) {

        this.input = input || "";
        this.offset = 0;
        this.length = this.input.length;
        this.lines = [-1];
        this.lastLineBreak = -1;
        
        this.value = "";
        this.number = 0;
        this.regexFlags = "";
        this.templateEnd = false;
        this.newlineBefore = false;
        this.strictError = "";
        this.start = 0;
        this.end = 0;
    }
    
    skip() {
        
        return this.next("skip");
    }
    
    next(context) {

        if (this.type !== "COMMENT")
            this.newlineBefore = false;
        
        this.strictError = "";
        
        do {
        
            this.start = this.offset;
            
            this.type = 
                this.start >= this.length ? this.EOF() : 
                context === "skip" ? this.Skip() :
                this.Start(context);
        
        } while (!this.type)
        
        this.end = this.offset;
        
        return this.type;
    }
    
    location(offset) {
    
        var line = binarySearch(this.lines, offset),
            pos = this.lines[line - 1],
            column = offset - pos;
        
        return { line, column, lineOffset: pos + 1 };
    }
    
    addLineBreak(offset) {
    
        if (offset > this.lastLineBreak)
            this.lines.push(this.lastLineBreak = offset);
    }
    
    peekChar() {
    
        return this.input.charAt(this.offset);
    }
    
    peekCharAt(n) {
    
        return this.input.charAt(this.offset + n);
    }
    
    peekCodePoint() {
    
        return Unicode.codePointAt(this.input, this.offset);
    }
    
    peekCode() {
    
        return this.input.charCodeAt(this.offset) | 0;
    }
    
    peekCodeAt(n) {
    
        return this.input.charCodeAt(this.offset + n) | 0;
    }
    
    readChar() {
    
        return this.input.charAt(this.offset++);
    }
    
    readUnicodeEscapeValue() {
    
        var hex = "";
        
        if (this.peekChar() === "{") {
        
            this.offset++;
            hex = this.readHex(0);
            
            if (hex.length < 1 || this.readChar() !== "}")
                return null;
        
        } else {
        
            hex = this.readHex(4);
        
            if (hex.length < 4)
                return null;
        }
        
        return parseInt(hex, 16);
    }
    
    readUnicodeEscape() {

        var cp = this.readUnicodeEscapeValue(),
            val = Unicode.toString(cp);
        
        return val === "" ? null : val;
    }
    
    readIdentifierEscape(startChar) {
    
        this.offset++;
        
        if (this.readChar() !== "u")
            return null;
        
        var cp = this.readUnicodeEscapeValue();
        
        if (startChar) {
        
            if (!Unicode.isIdentifierStart(cp))
                return null;
            
        } else {
        
            if (!Unicode.isIdentifierPart(cp))
                return null;
        }
        
        return Unicode.toString(cp);
    }
    
    readOctalEscape() {
    
        var m = octalEscape.exec(this.input.slice(this.offset, this.offset + 3)),
            val = m ? m[0] : "";
        
        this.offset += val.length;
        
        return val;
    }
    
    readStringEscape() {
    
        this.offset++;
        
        var chr = "", 
            esc = "";
        
        switch (chr = this.readChar()) {
        
            case "t": return "\t";
            case "b": return "\b";
            case "v": return "\v";
            case "f": return "\f";
            case "r": return "\r";
            case "n": return "\n";
    
            case "\r":
            
                this.addLineBreak(this.offset - 1);
                
                if (this.peekChar() === "\n")
                    this.offset++;
                
                return "";
            
            case "\n":
            case "\u2028":
            case "\u2029":
            
                this.addLineBreak(this.offset - 1);
                return "";

            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7":
            
                this.offset--;
                esc = this.readOctalEscape();
                
                if (esc === "0") {
                
                    return String.fromCharCode(0);
                
                } else {
                
                    this.strictError = "Octal literals are not allowed in strict mode";
                    return String.fromCharCode(parseInt(esc, 8));
                }
            
            case "x":
            
                esc = this.readHex(2);
                return (esc.length < 2) ? null : String.fromCharCode(parseInt(esc, 16));
            
            case "u":
            
                return this.readUnicodeEscape();
            
            default: 
            
                return chr;
        }
    }
    
    readRange(low, high) {
    
        var start = this.offset,
            code = 0;
        
        while (code = this.peekCode()) {
        
            if (code >= low && code <= high) this.offset++;
            else break;
        }
        
        return this.input.slice(start, this.offset);
    }
    
    readInteger() {
    
        var start = this.offset,
            code = 0;
        
        while (code = this.peekCode()) {
        
            if (code >= 48 && code <= 57) this.offset++;
            else break;
        }
        
        return this.input.slice(start, this.offset);
    }
    
    readHex(maxLen) {
        
        var str = "", 
            chr = "";
        
        while (chr = this.peekChar()) {
        
            if (!hexChar.test(chr))
                break;
            
            str += chr;
            this.offset++;
            
            if (str.length === maxLen)
                break;
        }
        
        return str;
    }
    
    peekNumberFollow() {
    
        var c = this.peekCode();
        
        if (c > 127)
            return !Unicode.isIdentifierStart(this.peekCodePoint());
    
        return !(
            c > 64 && c < 91 || 
            c > 96 && c < 123 ||
            c > 47 && c < 58 ||
            c === 36 ||
            c === 95 ||
            c === 92
        );
    }
    
    Skip() {
    
        var code = this.peekCode();
        
        if (code < 128) {
        
            switch (charTable[code]) {
        
                case "whitespace": return this.Whitespace();
            
                case "newline": return this.Newline(code);
            
                case "slash":
            
                    var next = this.peekCodeAt(1);

                    if (next === 47) return this.LineComment();       // /
                    else if (next === 42) return this.BlockComment(); // *
            }
        
        } else {
        
            // Unicode newlines
            if (isNewlineChar(this.peekChar()))
                return this.Newline(code);
        
            var cp = this.peekCodePoint();
            
            // Unicode whitespace
            if (Unicode.isWhitespace(cp))
                return this.UnicodeWhitespace(cp);
        }
        
        return "UNKNOWN";
    }
    
    Start(context) {
    
        var code = this.peekCode(), 
            next = 0;
        
        switch (charTable[code]) {
        
            case "punctuator-char": return this.PunctuatorChar();
            
            case "whitespace": return this.Whitespace();
            
            case "identifier": return this.Identifier(context, code);
            
            case "rbrace":
            
                if (context === "template") return this.Template();
                else return this.PunctuatorChar();
            
            case "punctuator": return this.Punctuator();
            
            case "newline": return this.Newline(code);
            
            case "decimal-digit": return this.Number();
            
            case "template": return this.Template();
            
            case "string": return this.String();
            
            case "zero": 
            
                switch (next = this.peekCodeAt(1)) {
                
                    case 88: case 120: return this.HexNumber();   // x
                    case 66: case 98: return this.BinaryNumber(); // b
                    case 79: case 111: return this.OctalNumber(); // o
                }
                
                return next >= 48 && next <= 55 ?
                    this.LegacyOctalNumber() :
                    this.Number();
            
            case "dot": 
            
                next = this.peekCodeAt(1);
                
                if (next >= 48 && next <= 57) return this.Number();
                else return this.Punctuator();
            
            case "slash":
            
                next = this.peekCodeAt(1);

                if (next === 47) return this.LineComment();       // /
                else if (next === 42) return this.BlockComment(); // *
                else if (context === "div") return this.Punctuator();
                else return this.RegularExpression();
            
        }
        
        // Unicode newlines
        if (isNewlineChar(this.peekChar()))
            return this.Newline(code);
        
        var cp = this.peekCodePoint();
        
        // Unicode whitespace
        if (Unicode.isWhitespace(cp))
            return this.UnicodeWhitespace(cp);
        
        // Unicode identifier chars
        if (Unicode.isIdentifierStart(cp))
            return this.Identifier(context, cp);
        
        return this.Error();
    }
    
    Whitespace() {
    
        this.offset++;
        
        var code = 0;
        
        while (code = this.peekCode()) {
        
            // ASCII Whitespace:  [\t] [\v] [\f] [ ] 
            if (code === 9 || code === 11 || code === 12 || code === 32)
                this.offset++;
            else
                break;
        }
        
        return "";
    }
    
    UnicodeWhitespace(cp) {
    
        this.offset += Unicode.length(cp);
        
        // General unicode whitespace
        while (Unicode.isWhitespace(cp = this.peekCodePoint()))
            this.offset += Unicode.length(cp);
        
        return "";
    }
    
    Newline(code) {
        
        this.addLineBreak(this.offset++);
        
        // Treat /r/n as a single newline
        if (code === 13 && this.peekCode() === 10)
            this.offset++;
        
        this.newlineBefore = true;
        
        return "";
    }
    
    PunctuatorChar() {
    
        return this.readChar();
    }
    
    Punctuator() {
        
        var op = this.readChar(), 
            chr = "",
            next = "";
        
        while (
            isPunctuatorNext(chr = this.peekChar()) &&
            multiCharPunctuator.test(next = op + chr)) {
    
            this.offset++;
            op = next;
        }
        
        // ".." is not a valid token
        if (op === "..") {
        
            this.offset--;
            op = ".";
        }
        
        return op;
    }
    
    Template() {
    
        var first = this.readChar(),
            end = false, 
            val = "", 
            esc = "",
            chr = "";
        
        while (chr = this.peekChar()) {
            
            if (chr === "`") {
            
                end = true;
                break;
            }
            
            if (chr === "$" && this.peekCharAt(1) === "{") {
            
                this.offset++;
                break;
            }
            
            if (chr === "\\") {
            
                esc = this.readStringEscape();
                
                if (!esc) 
                    return this.Error();
                
                val += esc;
                
            } else {
            
                val += chr;
                this.offset++;
            }
        }
        
        if (!chr)
            return this.Error();
        
        this.offset++;
        this.value = val;
        this.templateEnd = end;
        
        return "TEMPLATE";
    }
    
    String() {
    
        var delim = this.readChar(),
            val = "",
            esc = "",
            chr = "";
        
        while (chr = this.input[this.offset]) {
        
            if (chr === delim)
                break;
            
            if (isNewlineChar(chr))
                return this.Error();
            
            if (chr === "\\") {
            
                esc = this.readStringEscape();
                
                if (esc === null)
                    return this.Error();
                
                val += esc;
                
            } else {
            
                val += chr;
                this.offset++;
            }
        }
        
        if (!chr)
            return this.Error();
        
        this.offset++;
        this.value = val;
        
        return "STRING";
    }
    
    RegularExpression() {
    
        this.offset++;
        
        var backslash = false, 
            inClass = false,
            val = "", 
            chr = "",
            code = 0,
            flagStart = 0;
        
        while (chr = this.readChar()) {
        
            if (isNewlineChar(chr))
                return this.Error();
            
            if (backslash) {
            
                val += "\\" + chr;
                backslash = false;
            
            } else if (chr === "[") {
            
                inClass = true;
                val += chr;
            
            } else if (chr === "]" && inClass) {
            
                inClass = false;
                val += chr;
            
            } else if (chr === "/" && !inClass) {
            
                break;
            
            } else if (chr === "\\") {
            
                backslash = true;
                
            } else {
            
                val += chr;
            }
        }
        
        if (!chr)
            return this.Error();
        
        flagStart = this.offset;
        
        while (true) {
        
            code = this.peekCode();
        
            if (code === 92) {
            
                return this.Error();
            
            } else if (code > 127) {
            
                if (Unicode.isIdentifierPart(code = this.peekCodePoint()))
                    this.offset += Unicode.length(code);
                else
                    break;
            
            } else if (isIdentifierPartAscii(code)) {
            
                this.offset++;
                
            } else {
            
                break;
            }
        }
        
        this.value = val;
        this.regexFlags = this.input.slice(flagStart, this.offset);
        
        return "REGEX";
    }
    
    LegacyOctalNumber() {
    
        this.offset++;
        
        var start = this.offset,
            code = 0;
        
        while (code = this.peekCode()) {
        
            if (code >= 48 && code <= 55)
                this.offset++;
            else
                break;
        }
        
        this.strictError = "Octal literals are not allowed in strict mode";
        
        var val = parseInt(this.input.slice(start, this.offset), 8);
        
        if (!this.peekNumberFollow())
            return this.Error();
        
        this.number = val;
        
        return "NUMBER";
    }
    
    Number() {
    
        var start = this.offset,
            next = "";
        
        this.readInteger();
        
        if ((next = this.peekChar()) === ".") {
        
            this.offset++;
            this.readInteger();
            next = this.peekChar();
        }
        
        if (next === "e" || next === "E") {
        
            this.offset++;
            
            next = this.peekChar();
            
            if (next === "+" || next === "-")
                this.offset++;
            
            if (!this.readInteger())
                return this.Error();
        }
        
        var val = parseFloat(this.input.slice(start, this.offset));
        
        if (!this.peekNumberFollow())
            return this.Error();
        
        this.number = val;
        
        return "NUMBER";
    }
    
    BinaryNumber() {
    
        this.offset += 2;
        
        var val = parseInt(this.readRange(48, 49), 2);
        
        if (!this.peekNumberFollow())
            return this.Error();
        
        this.number = val;
        
        return "NUMBER";
    }
    
    OctalNumber() {
    
        this.offset += 2;
        
        var val = parseInt(this.readRange(48, 55), 8);
        
        if (!this.peekNumberFollow())
            return this.Error();
        
        this.number = val;
        
        return "NUMBER";
    }
    
    HexNumber() {
    
        this.offset += 2;
        
        var val = parseInt(this.readHex(0), 16);
        
        if (!this.peekNumberFollow())
            return this.Error();
        
        this.number = val;
        
        return "NUMBER";
    }
    
    Identifier(context, code) {
    
        var start = this.offset,
            val = "",
            esc = "";
        
        // Identifier Start
    
        if (code === 92) {

            esc = this.readIdentifierEscape(true);
    
            if (esc === null)
                return this.Error();
    
            val = esc;
            start = this.offset;

        } else if (code > 127) {

            this.offset += Unicode.length(code);
            
        } else {
        
            this.offset++;
        }
        
        // Identifier Part
        
        while (true) {
        
            code = this.peekCode();
        
            if (code === 92) {
            
                val += this.input.slice(start, this.offset++);
                esc = this.readIdentifierEscape(false);
                
                if (esc === null)
                    return this.Error();
                
                val += esc;
                start = this.offset;
            
            } else if (code > 127) {
            
                if (Unicode.isIdentifierPart(code = this.peekCodePoint()))
                    this.offset += Unicode.length(code);
                else
                    break;
            
            } else if (isIdentifierPartAscii(code)) {
            
                this.offset++;
                
            } else {
            
                break;
            }
        }
        
        val += this.input.slice(start, this.offset);
        
        if (context !== "name" && reservedWord.test(val))
            return esc ? this.Error() : val;
        
        this.value = val;
        
        return "IDENTIFIER";
    }
    
    LineComment() {
    
        this.offset += 2;
        
        var start = this.offset,
            chr = "";
        
        while (chr = this.peekChar()) {
        
            if (isNewlineChar(chr))
                break;
            
            this.offset++;
        }
        
        this.value = this.input.slice(start, this.offset);
        
        return "COMMENT";
    }
    
    BlockComment() {
    
        this.offset += 2;
        
        var pattern = blockCommentPattern,
            start = this.offset,
            m = null;
        
        while (true) {
        
            pattern.lastIndex = this.offset;
            
            m = pattern.exec(this.input);
            if (!m) return this.Error();
            
            this.offset = m.index + m[0].length;
            
            if (m[0] === "*/")
                break;
            
            this.newlineBefore = true;
            this.addLineBreak(m.index);
        }
        
        this.value = this.input.slice(start, this.offset - 2);
        
        return "COMMENT";
    }
    
    EOF() {
    
        return "EOF";
    }
    
    Error() {
    
        if (this.start === this.offset)
            this.offset++;
        
        return "ILLEGAL";
    }
    
}
