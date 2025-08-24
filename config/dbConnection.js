const { default: mongoose } = require("mongoose");

const dbConnection = async() => {
    try {
        const connect = await mongoose.connect(process.env.MONGODB_URI) ;
        // console.log(connect.connection.name) ;
        
    }
    catch(err) {
        // console.log(err) ;
        process.exit(1) ;
    }
}

module.exports = dbConnection ;