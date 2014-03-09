var path = Npm.require('path');
var mongodb = Npm.require('mongodb');
var chunkSize = 262144; // 256k is default GridFS chunk size

/**
 * @public
 * @constructor
 * @param {String} name - The store name
 * @param {Object} options
 * @param {Function} [options.beforeSave] - Function to run before saving a file from the server. The context of the function will be the `FS.File` instance we're saving. The function may alter its properties.
 * @param {Number} [options.maxTries=5] - Max times to attempt saving a file
 * @returns {FS.StorageAdapter} An instance of FS.StorageAdapter.
 *
 * Creates a GridFS store instance on the server. Inherits from FS.StorageAdapter
 * type.
 */

FS.Store.GridFS = function(name, options) {
  var self = this;
  options = options || {};
  var gridfsName = name

  if (!(self instanceof FS.Store.GridFS))
    throw new Error('FS.Store.GridFS missing keyword "new"');

  if (!options.mongoUrl) {
    options.mongoUrl = process.env.MONGO_URL;
    // When using a Meteor MongoDB instance, preface name with "cfs_gridfs."
    gridfsName = "cfs_gridfs." + name;
  }

  return new FS.StorageAdapter(name, options, {

    typeName: 'storage.gridfs',

    // Returns a readable Stream
    getStream: function(fileObj, callback) {
      var self = this;
      console.log("cfs-gridfs getStream Called");
      var fileInfo = fileObj.getCopyInfo(name);
      if (!fileInfo) { return callback(null, null); }
      var fileKey = fileInfo.key;

      mongodb.GridStore.exist(self.db, fileKey, gridfsName, {}, function (err, existing) {
        if (err) { return callback(err); }
        if (!existing) { return callback(null, null); }
        var gstore = new mongodb.GridStore(self.db, fileKey, 'r', { root: gridfsName });
        gstore.open(function (err, gs) {
          if (err) { return callback(err); }
          callback(null, gs.stream(true));
        });
      });
    },

    get: function(fileObj, callback) {
      var self = this;
      var fileInfo = fileObj.getCopyInfo(name);
      if (!fileInfo) { return callback(null, null); }
      var fileKey = fileInfo.key;

      mongodb.GridStore.exist(self.db, fileKey, gridfsName, {}, function (err, existing) {
        if (err) { return callback(err); }
        if (!existing) { return callback(null, null); }
        var gstore = new mongodb.GridStore(self.db, fileKey, 'r', { root: gridfsName });
        gstore.open(function (err, gs) {
          if (err) { return callback(err); }
          gs.read(function (err, result) {
            if (err) { return callback(err); }
            gs.close(function (err) {
              if (err) { return callback(err); }
              callback(null, result);
            });
          });
        });
      });
    },

    getBytes: function(fileObj, start, end, callback) {
      var self = this;
      var fileInfo = fileObj.getCopyInfo(name);
      if (!fileInfo) { return callback(null, null); }
      var fileKey = fileInfo.key;
      mongodb.GridStore.exist(self.db, fileKey, gridfsName, {}, function (err, existing) {
        if (err) { return callback(err); }
        if (!existing) { return callback(null, null); }
        var gstore = new mongodb.GridStore(self.db, fileKey, 'r', { root: gridfsName });
        gstore.open(function (err, gs) {
          if (err) { return callback(err); }
          gs.seek(start, function (err) {
            if (err) { return callback(err); }
            gs.read(end - start, function (err, result) {
              if (err) { return callback(err); }
              gs.close(function (err) {
                if (err) { return callback(err); }
                callback(null, result);
              });
            });
          });
        });
      });
    },

    // Returns a writable stream
    putStream: function(fileObj, callback) {
      var self = this;
      console.log("cfs-gridfs putStream Called");
      options = options || {};

      var fileKey = fileObj.collectionName + fileObj._id;
      var inputStream = fileObj.getStream();

      // Write stream to store once we have a suitable fileKey
      var writeStream = function (newFileKey) {
        var gridOptions = {
          root: gridfsName,
          chunk_size: options.chunk_size || chunkSize,
          metadata: fileObj.metadata || null,
          content_type: fileObj.type || 'application/octet-stream'
        };
        var gstore = new mongodb.GridStore(self.db, newFileKey, 'w', gridOptions);
        gstore.open(function (err, gs) {
          if (err) { return callback(err); }

          inputStream.on('data', function (chunk) {
            gs.write(chunk, function (err, result) {
              if (err) {
                inputStream.removeAllListeners();
                return callback(err);
              }
            });
          });

          inputStream.on('end', function () {
            gs.close(function (err) {
              if (err) { return callback(err); }
              callback(null, newFileKey);
            });
          });

          inputStream.on('error', function (err) {
            return callback(err);
          });
        });
      };

      if (options.overwrite) {
        writeStream(fileKey);
      } else {
        var fn = fileKey;
        var findUnusedFileKey = function (err, existing) {
          if (err) { return callback(err); }
          if (existing) {
            // Avoid deep recursion by appending a 6-digit base 36 pseudorandom number
            fileKey = fn + '_' + Math.floor(Math.random() * 2176782335).toString(36);
            mongodb.GridStore.exist(self.db, fileKey, gridfsName, {}, findUnusedFileKey);
          } else {
            writeStream(fileKey);
          }
        };
        mongodb.GridStore.exist(self.db, fileKey, gridfsName, {}, findUnusedFileKey);
      }
    },

    put: function(fileObj, options, callback) {
      var self = this;
      options = options || {};

      var fileKey = fileObj.collectionName + fileObj._id;
      var buffer = fileObj.getBuffer();

      // Write buffer to store once we have a suitable fileKey
      var writeBuffer = function (newFileKey) {
        var gridOptions = {
          root: gridfsName,
          chunk_size: options.chunk_size || chunkSize,
          metadata: fileObj.metadata || null,
          content_type: fileObj.type || 'application/octet-stream'
        };
        var gstore = new mongodb.GridStore(self.db, newFileKey, 'w', gridOptions);
        gstore.open(function (err, gs) {
          if (err) { return callback(err); }
          gs.write(buffer, function (err, result) {
            if (err) { return callback(err); }
            gs.close(function (err) {
              if (err) { return callback(err); }
              callback(null, newFileKey);
            });
          });
        });
      };

      if (options.overwrite) {
        writeBuffer(fileKey);
      } else {
        var fn = fileKey;
        var findUnusedFileKey = function (err, existing) {
          if (err) { return callback(err); }
          if (existing) {
            // Avoid deep recursion by appending a 6-digit base 36 pseudorandom number
            fileKey = fn + '_' + Math.floor(Math.random() * 2176782335).toString(36);
            mongodb.GridStore.exist(self.db, fileKey, gridfsName, {}, findUnusedFileKey);
          } else {
            writeBuffer(fileKey);
          }
        };
        mongodb.GridStore.exist(self.db, fileKey, gridfsName, {}, findUnusedFileKey);
      }
    },

    del: function(fileObj, callback) {
      var self = this;
      var fileInfo = fileObj.getCopyInfo(name);
      if (!fileInfo) { return callback(null, true); }
      var fileKey = fileInfo.key;
      mongodb.GridStore.unlink(self.db, fileKey, { root: gridfsName }, function (err) {
        if (err) { return callback(err); }
        callback(null, true);
      });
    },

    watch: function() {
      throw new Error("GridFS storage adapter does not support the sync option");
    },

    init: function(callback) {
      var self = this;
      mongodb.MongoClient.connect(options.mongoUrl, function (err, db) {
        if (err) { return callback(err); }
        self.db = db;
        callback(null);
      });
    }
  });
};
