import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zstkslczesscigdacubm.supabase.co'
const supabaseAnonKey = 'sb_publishable_RFfE74Lfsb0sD-Ge-deJjg_DaolIpbM'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function test() {
    console.log("Testing fetch with anon key...")
    const { data, error } = await supabase
        .from("property_api_settings")
        .select("*")
    
    if (error) {
        console.error("Error:", error.message)
    } else {
        console.log("Success! Found", data.length, "properties.")
        data.forEach(p => console.log("-", p.property_name))
    }
}

test()
