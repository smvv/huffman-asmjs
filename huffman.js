// --- Simplified Module library from Emscripten  -----------------------------

var Module;

if (!Module) {
    Module = {};

    // The environment setup code below is customized to use Module.
    var ENVIRONMENT_IS_NODE = typeof process === 'object'
                              && typeof require === 'function';
    var ENVIRONMENT_IS_WEB = typeof window === 'object';
    var ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
    var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE
                               && !ENVIRONMENT_IS_WORKER;

    if (ENVIRONMENT_IS_NODE) {
        // Expose functionality in the same simple way that the shells work
        // Note that we pollute the global namespace here, otherwise we break
        // in node
        if (!Module['print'])
            Module['print'] = function print(x) {
                process['stdout'].write(x + '\n');
            };

        if (!Module['printErr'])
            Module['printErr'] = function printErr(x) {
                process['stderr'].write(x + '\n');
            };

    } else if (ENVIRONMENT_IS_SHELL) {
        if (!Module['print'])
            Module['print'] = print;

        if (typeof printErr != 'undefined')
            Module['printErr'] = printErr; // not present in v8 or older sm
    } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
        if (typeof console !== 'undefined') {
            if (!Module['print'])
                Module['print'] = function print(x) {
                    console.log(x);
                };

            if (!Module['printErr'])
                Module['printErr'] = function printErr(x) {
                    console.log(x);
                };
        }
    }
}

var TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;
var HEAP = new ArrayBuffer(TOTAL_MEMORY);

var STDLIB = {
    "Math": Math, "Int32Array": Int32Array, "Uint8Array": Uint8Array
};

var FOREIGN = {
    "print": Module['print']
}

// --- Huffman compressing library --------------------------------------------

var Huffman = (function(stdlib, foreign, heap) {
    "use asm";

    // --- Standard library aliases -------------------------------------------
    // Create an alias for Math.sin because asm.js does not allow method lookup
    // inside functions. The following asmjs error is generated when you do a
    // method lookup inside a function:
    //
    //      warning: asm.js type error: unexpected callee expression type
    //
    // You can fix this error by creating an alias in the `preamble' of the
    // asmjs module.
    var sin = stdlib.Math.sin;
    var print = foreign.print;

    // --- Heaps --------------------------------------------------------------
    var HEAPU8 = new stdlib.Uint8Array(heap);
    var HEAPI32 = new stdlib.Int32Array(heap);

    // --- Constants ----------------------------------------------------------
    var FREQ_TABLE_LENGTH   =  256; // size: 256 x 4 bytes
    var HUFF_NODES_LENGTH   =    0; // size: 512 x 16 bytes
    var HUFF_SYMBOLS_LENGTH =    0; // size: ...

    // --- Heap memory offsets ------------------------------------------------
    var FREQ_TABLE_OFFSET   =    0;
    var HUFF_NODES_OFFSET   = 1024; // ^ + 4 * FREQ_TABLE_LENGTH
    //var HUFF_SYMBOLS_OFFSET =  9216; // ^ + 16 * HUFF_NODES_LENGTH

    //var INPUT_DATA_OFFSET   = 74752; // ^ + 256 * 256 (= all symbol lists)
    var INPUT_DATA_OFFSET   = 9216; // ^ + 256 * 256 (= all symbol lists)
    var INPUT_DATA_LENGTH   =    0; // size: depends on input data

    // --- Methods ------------------------------------------------------------

    function _generateLookup(lookup, node, value) {
        lookup = lookup | 0;
        node = node | 0;
        value = value | 0;

        var msb = 0;
        var tmp = 0;

        if (HEAPI32[(node + 8 | 0) >> 2] | 0) {
            value = value << 1;
            _generateLookup(lookup, HEAPI32[(node +  8) >> 2] | 0, value);
            _generateLookup(lookup, HEAPI32[(node + 12) >> 2] | 0, value | 1);
        } else {
            HEAPI32[(lookup + (HEAPI32[node >> 2] << 2 | 0) | 0) >> 2] = value;
        }
    }

    function _buildLookup(data, dataLength) {
        data = data | 0;
        dataLength = dataLength | 0;

        var j = 0;
        var i = 0;
        var i_end = 0;

        var data_i = 0;
        var node_i = 0;
        var node_j = 0;

        var tmp1 = 0;
        var tmp2 = 0;
        var tmp3 = 0;
        var tmp4 = 0;
        //var tmp5 = 0;

        // Clear any previously generated huffman nodes or huffman symbol
        // lists by resetting their length properties.
        HUFF_SYMBOLS_LENGTH = 0;

        // Set the frequency table entries to zero.
        i_end = FREQ_TABLE_OFFSET + (4 * FREQ_TABLE_LENGTH | 0) | 0;

        for (i = FREQ_TABLE_OFFSET | 0; (i | 0) < (i_end | 0); i = i + 4 | 0)
            HEAPI32[i >> 2] = 0;

        // Count the character frequencies.
        i_end = (data + dataLength) | 0;

        for (i = data | 0; (i | 0) < (i_end | 0); i = i + 1 | 0) {
            data_i = FREQ_TABLE_OFFSET + ((HEAPU8[i] << 2 | 0)) | 0;
            HEAPI32[data_i >> 2] = (HEAPI32[data_i >> 2] | 0) + 1 | 0;
        }

        // Build the initial huffman tree nodes.
        i_end = FREQ_TABLE_OFFSET + (4 * FREQ_TABLE_LENGTH | 0) | 0;
        node_i = HUFF_NODES_OFFSET;
        j = 0;

        for (i = FREQ_TABLE_OFFSET | 0; (i | 0) < (i_end | 0); i = i + 4 | 0) {
            HEAPI32[node_i >> 2] = j;
            node_i = node_i + 4 | 0;

            HEAPI32[node_i >> 2] = HEAPI32[i >> 2] | 0;
            node_i = node_i + 4 | 0;

            HEAPI32[node_i >> 2] = 0;
            node_i = node_i + 4 | 0;

            HEAPI32[node_i >> 2] = 0;
            node_i = node_i + 4 | 0;

            j = j + 1 | 0;
        }

        HUFF_NODES_LENGTH = 256;

        // Create a list of sorted huffman nodes, using insertion sort.
        node_i = HUFF_NODES_OFFSET | 0;
        i_end = HUFF_NODES_OFFSET + (16 * HUFF_NODES_LENGTH | 0) | 0;

        for (; (node_i | 0) < (i_end | 0); node_i = node_i + 16 | 0) {
            // Copy all values of the current node to temporary variables.
            tmp1 = (HEAPI32[(node_i     ) >> 2] | 0) | 0;
            tmp2 = (HEAPI32[(node_i +  4) >> 2] | 0) | 0;
            tmp3 = (HEAPI32[(node_i +  8) >> 2] | 0) | 0;
            tmp4 = (HEAPI32[(node_i + 12) >> 2] | 0) | 0;

            node_j = node_i;

            // Shift all element with a higher frequencies than the current
            // frequency with one position to the end of the array.
            while((node_j | 0) > (HUFF_NODES_OFFSET | 0)) {
                if ((HEAPI32[(node_j - 12 | 0) >> 2] | 0) <= (tmp2 | 0))
                    break;

                HEAPI32[(node_j     ) >> 2] = HEAPI32[(node_j - 16) >> 2];
                HEAPI32[(node_j +  4) >> 2] = HEAPI32[(node_j - 12) >> 2];
                HEAPI32[(node_j +  8) >> 2] = HEAPI32[(node_j -  8) >> 2];
                HEAPI32[(node_j + 12) >> 2] = HEAPI32[(node_j -  4) >> 2];

                node_j = node_j - 16 | 0;
            }

            // Store the saved values in the empty slot.
            HEAPI32[(node_j     ) >> 2] = tmp1;
            HEAPI32[(node_j +  4) >> 2] = tmp2;
            HEAPI32[(node_j +  8) >> 2] = tmp3;
            HEAPI32[(node_j + 12) >> 2] = tmp4;
        }

        node_i = HUFF_NODES_OFFSET | 0;
        i_end = HUFF_NODES_OFFSET + (16 * HUFF_NODES_LENGTH | 0) | 0;

        // Construct the tree of huffman nodes. The construction stops when
        // there is one node left. The remaining node is the root node of the
        // huffman tree.
        while ((node_i + 16 | 0) < (i_end | 0)) {
            // Get the symbol list and frequency of the first node.
            tmp1 = HEAPI32[(node_i    ) >> 2] | 0;
            tmp2 = HEAPI32[(node_i + 4) >> 2] | 0;

            // Get the symbol list and frequency of the second node.
            node_j = node_i + 16 | 0;
            tmp3 = HEAPI32[(node_j    ) >> 2] | 0;
            tmp4 = HEAPI32[(node_j + 4) >> 2] | 0;

            //// Allocate a memory area for the merged symbol list.
            //// TODO reduce the symbol list size. This requires an ASMJS
            //// malloc-like function which will return a pointer to an
            //// `allocated' memory area.
            //tmp5 = HUFF_SYMBOLS_OFFSET + (256 * HUFF_SYMBOLS_LENGTH | 0) | 0;
            //HUFF_SYMBOLS_LENGTH = HUFF_SYMBOLS_LENGTH + 1 | 0;

            //// Merge the two symbol lists together.
            //i = tmp5;

            //// TODO: sort the symbol list while merging.

            //// If the node has no pointers set to other nodes, the node is a
            //// leaf node and has only one symbol. Leaf nodes do not have a
            //// pointer to a symbol list, but just the symbol.
            //if ((HEAPI32[(node_i + 8) >> 2] | 0) == 0) {
            //    HEAPU8[i] = tmp1 | 0;
            //    i = i + 1 | 0;
            //} else {
            //    while (HEAPU8[tmp1] | 0) {
            //        HEAPU8[i] = HEAPU8[tmp1] | 0;
            //        i = i + 1 | 0;
            //        tmp1 = tmp1 + 1 | 0;
            //    }

            //    // Mark the end of the symbol list
            //    HEAPU8[i] = 0;
            //}

            //// If the node has no pointers set to other nodes, the node is a
            //// leaf node and has only one symbol. Leaf nodes do not have a
            //// pointer to a symbol list, but just the symbol.
            //if ((HEAPI32[(node_j + 8) >> 2] | 0) == 0) {
            //    HEAPU8[i] = tmp3 | 0;
            //    i = i + 1 | 0;
            //} else {
            //    while (HEAPU8[tmp3] | 0) {
            //        HEAPU8[i] = HEAPU8[tmp3] | 0;
            //        i = i + 1 | 0;
            //        tmp3 = tmp3 + 1 | 0;
            //    }

            //    // Mark the end of the symbol list
            //    HEAPU8[i] = 0;
            //}

            // Store the new huffman node in the huffman nodes list.
            //HEAPI32[(i_end     ) >> 2] = tmp5 | 0;
            HEAPI32[(i_end     ) >> 2] = 0 | 0;
            HEAPI32[(i_end +  4) >> 2] = tmp2 + tmp4 | 0;

            if ((tmp2 | 0) > (tmp4 | 0)) {
                HEAPI32[(i_end +  8) >> 2] = node_j | 0;
                HEAPI32[(i_end + 12) >> 2] = node_i | 0;
            } else {
                HEAPI32[(i_end +  8) >> 2] = node_i | 0;
                HEAPI32[(i_end + 12) >> 2] = node_j | 0;
            }

            // Pop the first two nodes from the huffman nodes list.
            node_i = node_i + 32 | 0;

            // Apply insertion sort on the last inserted node.

            // Copy all values of the current node to temporary variables.
            tmp1 = (HEAPI32[(i_end    ) >> 2] | 0) | 0;
            tmp2 = (HEAPI32[(i_end +  4) >> 2] | 0) | 0;
            tmp3 = (HEAPI32[(i_end +  8) >> 2] | 0) | 0;
            tmp4 = (HEAPI32[(i_end + 12) >> 2] | 0) | 0;

            node_j = i_end;

            // Shift all element with a higher frequencies than the current
            // frequency with one position to the end of the array.
            while((node_j | 0) > (HUFF_NODES_OFFSET | 0)) {
                if ((HEAPI32[(node_j - 12 | 0) >> 2] | 0) <= (tmp2 | 0))
                    break;

                HEAPI32[(node_j     ) >> 2] = HEAPI32[(node_j - 16) >> 2];
                HEAPI32[(node_j +  4) >> 2] = HEAPI32[(node_j - 12) >> 2];
                HEAPI32[(node_j +  8) >> 2] = HEAPI32[(node_j -  8) >> 2];
                HEAPI32[(node_j + 12) >> 2] = HEAPI32[(node_j -  4) >> 2];

                node_j = node_j - 16 | 0;
            }

            // Store the saved values in the empty slot.
            HEAPI32[(node_j     ) >> 2] = tmp1;
            HEAPI32[(node_j +  4) >> 2] = tmp2;
            HEAPI32[(node_j +  8) >> 2] = tmp3;
            HEAPI32[(node_j + 12) >> 2] = tmp4;

            // Increase the huffman nodes list size.
            i_end = i_end + 16 | 0;
        }

        // Generate a hashmap for faster lookup. Overwrite the frequency table,
        // because it will not be used anymore when the lookup table is done.
        _generateLookup(FREQ_TABLE_OFFSET, node_i, 1);

        return FREQ_TABLE_OFFSET | 0;
    }

    function _encode(data, dataLength, lookup) {
        data = data | 0;
        dataLength = dataLength | 0;
        lookup = lookup | 0;

        var len = 0;

        var binary = 0;
        var binary_index = 0;
        var available = 0;
        var msb = 0;
        var tmp = 0;

        var data_i = 0;
        var replacement = 0;
        var i = 0;
        var i_end = 0;

        i_end = (data + dataLength) | 0;

        for (i = data | 0; (i | 0) < (i_end | 0); i = i + 1 | 0) {
            // Find the encoding replacement value in the lookup table
            data_i = HEAPU8[i] | 0;
            replacement = HEAPI32[(lookup + (data_i << 2) | 0) >> 2] | 0;

            // Find the first non-zero bit, or return the last bit.
            msb = 0;
            tmp = replacement;

            if (tmp & 0xffff0000) {
                msb = msb +  16 | 0;
                tmp = tmp >> 16 | 0;
            }

            if (tmp & 0x0000ff00) {
                msb = msb +  8 | 0;
                tmp = tmp >> 8 | 0;
            }

            if (tmp & 0x000000f0) {
                msb = msb +  4 | 0;
                tmp = tmp >> 4 | 0;
            }

            // TODO reorder if statements. Smaller 'msb' are more common?.
            if ((tmp | 0) >= 8)
                msb = msb + 4 | 0;
            else if ((tmp | 0) >= 4)
                msb = msb + 3 | 0;
            else if ((tmp | 0) >= 2)
                msb = msb + 2 | 0;
            else if ((tmp | 0) >= 1)
                msb = msb + 1 | 0;

            // Skip the first most significant bit. This bit is set because
            // there is otherwise no way of shifting zeros to the left. The
            // first significat bit should therefore be removed because it is
            // not part of the replacement value.
            msb = msb - 1 | 0;

            available = 8 - binary_index | 0;

            // If there are enough bits available, append the bits to the
            // current byte by shifting the old bits to the right and storing
            // the new bits at the created space.
            if ((msb | 0) <= (available | 0)) {
                switch (msb | 0) {
                    case 0: binary = binary      | (replacement & 0x1 ); break;
                    case 1: binary = binary << 1 | (replacement & 0x3 ); break;
                    case 2: binary = binary << 2 | (replacement & 0x7 ); break;
                    case 3: binary = binary << 3 | (replacement & 0xf ); break;
                    case 4: binary = binary << 4 | (replacement & 0x1f); break;
                    case 5: binary = binary << 5 | (replacement & 0x3f); break;
                    case 6: binary = binary << 6 | (replacement & 0x7f); break;
                    case 7: binary = binary << 7 | (replacement & 0xff); break;
                }

                binary_index = binary_index + msb | 0;

                if ((binary_index | 0) == 8) {
                    HEAPU8[HUFF_NODES_OFFSET + len | 0] = binary | 0;
                    len = len + 1 | 0;
                    binary = 0;
                    binary_index = 0;
                }
            } else {
                // Create a bitmask
                tmp = 1 << msb;

                // For each bit in the replacement bits, append the bit o the
                // current byte by shifting the old bits to the right and
                // storing the new bits at the created space.
                for (; (msb | 0) >= 0; msb = msb - 1 | 0) {
                    binary = (binary << 1) | ((replacement & tmp) >> msb | 0);
                    tmp = tmp >> 1 | 0;
                    binary_index = binary_index + 1 | 0;

                    if ((binary_index | 0) == 8) {
                        HEAPU8[HUFF_NODES_OFFSET + len | 0] = binary | 0;
                        len = len + 1 | 0;
                        binary = 0;
                        binary_index = 0;
                    }
                }
            }
        }

        if (binary | 0) {
            binary = binary << (8 - binary_index - 1) | 0;
            HEAPU8[HUFF_NODES_OFFSET + len | 0] = binary | 0;
            len = len + 1 | 0;
        }

        return len | 0;
    }

    function getInputDataOffset() {
        return INPUT_DATA_OFFSET | 0;
    }

    function getInputDataLength() {
        return INPUT_DATA_LENGTH | 0;
    }

    function setInputDataLength(length) {
        length = length | 0;
        INPUT_DATA_LENGTH = length | 0;
    }

    return {
        _buildLookup: _buildLookup,
        _encode: _encode,
        getInputDataOffset: getInputDataOffset,
        getInputDataLength: getInputDataLength,
        setInputDataLength: setInputDataLength
    };
})(STDLIB, FOREIGN, HEAP);

(function() {
    function determineDataLength(data) {
        var data_length = 0;

        if ('length' in data) {
            data_length = data.length;
        } else if ('width' in data && 'height' in data) {
            data_length = data.width * data.height;
        } else {
            throw 'Unsupported input data format';
        }

        return data_length;
    }

    function copyInputData(data_offset, data) {
        var HEAPU8 = new Uint8Array(HEAP);

        if (data.data)
            data = data.data;

        var data_length = determineDataLength(data);

        // TODO: avoid copying data to the heap.
        for (var i = 0; i < data_length; i++)
            HEAPU8[data_offset + i] = data[i];

        Huffman.setInputDataLength(data_length);

        return data_length;
    }

    Huffman.buildLookup = function(data) {
        var data_offset = Huffman.getInputDataOffset();
        var data_length = copyInputData(data_offset, data);
        return Huffman._buildLookup(data_offset, data_length);
    };

    Huffman.encode = function(data) {
        var data_offset = Huffman.getInputDataOffset();
        var data_length;

        if (data)
            data_length = copyInputData(data_offset, data);
        else
            data_length = Huffman.getInputDataLength();

        return Huffman._encode(data_offset, data_length);
    };
})();
