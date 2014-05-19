(function ($, window, document, undefined) {

    'use strict';
    (function() {

        var streaming = false,
            video = document.querySelector('#video'),
            canvas = document.querySelector('#canvas'),
            startbutton = document.querySelector('#startbutton'),
            width = 640,
            height = 0;

        navigator.getMedia = ( navigator.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia ||
            navigator.msGetUserMedia);

        navigator.getMedia({
                video: true,
                audio: false
            },
            function(stream) {
                if (navigator.mozGetUserMedia) {
                    video.mozSrcObject = stream;
                } else {
                    var vendorURL = window.URL || window.webkitURL;
                    video.src = vendorURL.createObjectURL(stream);
                }
                video.play();
            },
            function(err) {
                var $error = $('<div class="alert alert-danger"/>');
                $error.text('Error: ' + err);
                $('.main').prepend($error);
            }
        );

        video.addEventListener('canplay', function() {
            if (!streaming) {
                var heightInterval = setInterval(function() {
                    if (!video.videoHeight) {
                        return;
                    }

                    if (!streaming) {
                        console.log(video.videoHeight, video.videoWidth, width);
                        height = video.videoHeight / (video.videoWidth / width);
                        video.setAttribute('width', width);
                        video.setAttribute('height', height);
                        streaming = true;
                    }

                    clearInterval(heightInterval);
                }, 50);
            }
        }, false);

        function takePicture() {
            var image = video;

            canvas.width = width;
            canvas.height = height;

            var ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, width, height);
            var imageData = ctx.getImageData(0, 0, width, height);
            var imageSize = imageData.width * imageData.height;

            var data = new Uint8Array(imageSize);

            var coeff_r = 4899, coeff_g = 9617, coeff_b = 1868;

            for (var j = 0, i = 0; i < imageSize; i += 4, ++j) {
                data[j] = (imageData.data[i] * coeff_r
                        + imageData.data[i + 1] * coeff_g
                        + imageData.data[i + 2] * coeff_b + 8192) >> 14;
            }

            var originalLength = data.length;

            var startTime = new Date();
            Huffman.buildLookup(data);
            var endTime = new Date();

            console.log('built in ' + (endTime - startTime) + 'ms');

            var startTime = new Date();
            var encodedLength = Huffman.encode();
            var endTime = new Date();

            console.log('encoded in ' + (endTime - startTime) + 'ms');

            var inputSize = (originalLength / 1024.);
            var outputSize = (encodedLength / 1024.);
            var ratio = originalLength / encodedLength;

            console.log('rgba length is ' + (inputSize * 4) + ' KB');
            console.log('gray length is ' + inputSize + ' KB');
            console.log('encoded length is ' + outputSize + ' KB');
            console.log('compression ratio is ' + ratio);
        }

        startbutton.addEventListener('click', function(ev) {
            takePicture();
            ev.preventDefault();
        }, false);

    })();

})(jQuery, window, document);
