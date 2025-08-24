const asyncHandler = require("express-async-handler") ;
const jwt = require("jsonwebtoken") ;

const getAuth = asyncHandler(async(req, res) => {
    const {token} = req.query ;
    if(! token) {
        res.status(400) ;
        throw new Error("Token not Found") ;
    }
    await jwt.verify(token , process.env.PRIVATE_KEY , async(err , decoded) => {
        if(err) {
            res.status(400) ;
            throw new Error("Invalid Token") ;
        }
        const userEmail = decoded.email ;

        const sessionToken = await jwt.sign({ email: userEmail }, process.env.PRIVATE_KEY, { expiresIn: "10m" });

        res.redirect(`https://yourfrontend.com/dashboard?token=${sessionToken}`);
    })  
}) ;

module.exports = getAuth ;