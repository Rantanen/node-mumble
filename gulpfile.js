
"use strict";

var gulp = require( 'gulp' );
var jshint = require( 'gulp-jshint' );
var jsdoc2md = require( 'gulp-jsdoc-to-markdown' );
var rename = require( 'gulp-rename' );
var filter = require( 'gulp-filter' );
var es = require( 'event-stream' );
var gutil = require( 'gulp-util' );
var shell = require( 'gulp-shell' );

var src = [
    'index.js',
    'lib/**/*.js'
];

var src_all = src.concat([
    'gulpfile.js'
]);

var ghtoken = process.env.GITHUB_TOKEN;

gulp.task( 'jshint', function() {

    return gulp.src( src_all )
        .pipe(jshint())
        .pipe(jshint.reporter( 'jshint-stylish' ))
        .pipe(jshint.reporter( 'fail' ));
});

gulp.task( 'docs', function() {

    return gulp.src( src )
        .pipe( jsdoc2md({ 'param-list-format': 'list', plugin: 'dmd-clean' }) )
        .pipe( filter( function(a) { return a.stat && a.stat.size; } ) )
        .pipe( rename( function( path ) { path.extname = '.md'; }) )
        .pipe( gulp.dest( 'docs' ) );
});

gulp.task( 'upload-docs', [ 'docs' ], shell.task([
    'git clone https://' + ghtoken + ':@github.com/Rantanen/node-mumble.wiki.git wiki',
    'cp docs/*.md wiki/api/',
    'cd wiki && git add api/*.md',
    'cd wiki && git commit -m "API documentation update" && git push || echo ',
    'rm -rf wiki'
]));

gulp.task( 'check-mode', function() {

    var fail = [];
    return gulp.src( src_all )
        .pipe( es.through( function( file, cb ) {
            var mode = file.stat.mode;
            var requiredMode = parseInt( '0600', 8 );
            var deniedMode = parseInt( '0111', 8 );

            file.checkMode = { fail: false };

            if( mode & requiredMode !== requiredMode ) {
                gutil.log( "Warning:", file.path, "doesn't have read/write permissions" );
                file.checkMode.fail = true;
            }
            if( mode & deniedMode > 0 ) {
                gutil.log( "Warning:", file.path, "has executable permission" );
                file.checkMode.fail = true;
            }

            if( file.checkMode.fail )
                fail.push( file.path );

        },
        function() {
            if( fail.length > 0 )
                this.emit( 'error', new gutil.PluginError( 'check-mode', {
                    message: 'Check-mode failed for:\n        ' + fail.join( ',\n        ' ),
                    showStack: false
                }));
        }));
});

gulp.task( 'default', [ 'jshint', 'check-mode' ]);
