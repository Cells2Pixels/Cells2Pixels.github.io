window.HELP_IMPROVE_VIDEOJS = false;


$(document).ready(function() {
    // Check for click events on the navbar burger icon

    var options = {
			slidesToScroll: 1,
			slidesToShow: 1,
			loop: true,
			infinite: true,
			autoplay: false,
			autoplaySpeed: 3000,
    }

		// Initialize all div with carousel class
    var carousels = bulmaCarousel.attach('.carousel', options);

    // Loop on each carousel initialized
    for(var i = 0; i < carousels.length; i++) {
    	// Add listener to  event
    	carousels[i].on('before:show', state => {
    		console.log(state);
    	});
    }

    // Access to bulmaCarousel instance of an element
    var element = document.querySelector('#my-element');
    if (element && element.bulmaCarousel) {
    	// bulmaCarousel instance is available as element.bulmaCarousel
    	element.bulmaCarousel.on('before-show', function(state) {
    		console.log(state);
    	});
    }

    /*var player = document.getElementById('interpolation-video');
    player.addEventListener('loadedmetadata', function() {
      $('#interpolation-slider').on('input', function(event) {
        console.log(this.value, player.duration);
        player.currentTime = player.duration / 100 * this.value;
      })
    }, false);*/

    bulmaSlider.attach();

})


// ===========================================================
//      JAVASCRIPT helper — highlights the selected thumbnail
// ===========================================================
function highlightThumb(index) {
	// Clear highlights from all thumbs
	document.querySelectorAll('.thumb-img').forEach(img => {
		img.style.border = '';
	});

	// Highlight the selected one
	const selected = document.getElementById('thumb-' + index);
	if (selected) {
		selected.style.border = '3px solid #00aaff';
		selected.style.borderRadius = '8px';
	}
}


window.onload = function () {
	tab_gallery_click('bubbly_0101');
	highlightThumb('bubbly_0101');
};

function tab_gallery_click(idx) {
	const leftImage1 = `data/images/lppn_nca/${idx}_nca.png`;
	const rightImage1 = `data/images/lppn_nca/${idx}_lppn.png`;

	document.getElementById("juxtapose-embed-1").innerHTML = "";
	// document.getElementById("juxtapose-embed-2").innerHTML = "";

	new juxtapose.JXSlider('#juxtapose-embed-1',
		[
			{src: leftImage1, label: 'NCA Cell State'},
			{src: rightImage1, label: 'LPPN Output'}
		],
		{
			animate: true,
			showLabels: true,
			showCredits: false,
			makeResponsive: true,
			startingPosition: "50%"
		});


}


// Initialise every gallery on the page
document.addEventListener("DOMContentLoaded", () => {
	const galleries = document.querySelectorAll(".video-gallery");

	galleries.forEach(gallery => {
		const mainVideo = gallery.querySelector("video");
		const thumbs = gallery.querySelectorAll(".thumb-img");

		function setActive(target) {
			thumbs.forEach(t => t.classList.remove("active"));
			target.classList.add("active");
		}

		thumbs.forEach(img => {
			img.addEventListener("click", () => {
				const sourcePath = img.dataset.video;
				const sourceTag = mainVideo.querySelector("source");

				if (sourceTag.src.endsWith(sourcePath)) {
					mainVideo.currentTime = 0;
					mainVideo.play();
				} else {
					sourceTag.src = sourcePath;
					mainVideo.load();
					mainVideo.play();
				}
				setActive(img);
			});
		});

		// set first thumb as active at load time
		if (thumbs[0]) setActive(thumbs[0]);
	});
});
